import type { PluginContext } from '@qqbot/sdk';
import type { OperationReceipt, PointsErrorCode, Result } from '../contracts.js';
import type { WalletPolicy } from './policies.js';
import { readReady } from './storage/schema.js';
import { failure, PointsFault, requireCondition, success, systemFailure } from './errors.js';
import { identifier, replay, requestHash } from './ledger/operations.js';
import { minor, proportionalFee, sumMinor } from './amounts.js';
import { LIMITS } from './limits.js';
import { DATABASE_NOW_MS } from './time.js';
import { operationPermissionSql, statement } from './storage/sql.js';
import { emptySnapshot } from './ledger/snapshot.js';
import type { AccountRow } from './model.js';
import { LedgerPlan } from './ledger/plan.js';
import { transfer } from './transactions.js';
import { commit } from './ledger/commit.js';

interface IntentData {
    intent_id: string;
    bot_id: string;
    from_user_id: string;
    to_user_id: string;
    amount_minor: number;
    fee_minor: number;
    fee_policy_version: number;
    created_at_ms: number;
    expires_at_ms: number;
    origin_message_id: string;
    request_hash: string;
    confirmation_code: string;
}
export type TransferIntent = IntentData & ({ status: 'pending' } | {
    status: 'committed' | 'rejected' | 'cancelled' | 'expired';
    result: Result<OperationReceipt>;
});

type IntentAccount = Omit<AccountRow, 'bot_id'>;
const ACCOUNT_COLUMNS = ['user_id', 'available_minor', 'reserved_minor', 'status', 'version', 'created_at_ms', 'updated_at_ms'] as const;
type IntentExecution = IntentData & {
    ledger_revision: number;
    observed_at_ms: number;
    operation_hash: string | null;
    operation_status: 'committed' | 'rejected' | null;
    operation_result: string | null;
    source: string | null;
    enabled: number;
    operation_permissions: string;
    read_permissions: string;
    policy_version: number;
} & { [K in keyof IntentAccount as `sender_${K}`]: IntentAccount[K] | null }
    & { [K in keyof IntentAccount as `recipient_${K}`]: IntentAccount[K] | null };

export async function createTransferIntent(ctx: PluginContext, user: string, recipient: string, amount: number, messageId: string): Promise<Result<TransferIntent>> {
    try {
        [user, recipient, messageId].forEach(identifier);
        requireCondition(user !== recipient, 'INVALID_ARGUMENT');
        minor(amount);
        requireCondition(amount <= LIMITS.amountMinor, 'LIMIT_EXCEEDED');
        const hash = await requestHash('qq.create', { user, recipient, amount, messageId });
        // 同一机器人、本人和原消息只有一个主键；金额及收款人仍由请求摘要检查冲突。
        const id = await requestHash('qq.intent-id', { botId: ctx.botId, user, messageId });
        const old = await findIntent(ctx, id);

        if (old.intent_id) { return success(await existingIntent(old, hash)); }

        // 首条查询已取得费率快照；写入仍以政策版本和账户状态作原子条件。
        const policy = old;
        requireCondition(policy.qq_transfer_enabled === 1, 'TRANSFER_DISABLED');
        const accounts = await ctx.db.first<{ sender_status: AccountRow['status'] | null; recipient_status: AccountRow['status'] | null }>(`SELECT
            (SELECT status FROM {accounts} WHERE bot_id=? AND user_id=?) AS sender_status,
            (SELECT status FROM {accounts} WHERE bot_id=? AND user_id=?) AS recipient_status`, ctx.botId, user, ctx.botId, recipient);
        requireCondition(accounts && accounts.sender_status !== null && accounts.recipient_status !== null, 'ACCOUNT_NOT_FOUND');
        requireCondition(accounts?.sender_status === 'active', 'ACCOUNT_SUSPENDED');
        const fee = policy.qq_fee_mode === 'free' ? 0 : proportionalFee(amount, policy.qq_fee_numerator, policy.qq_fee_denominator);
        requireCondition(sumMinor([amount, fee]) <= LIMITS.amountMinor, 'LIMIT_EXCEEDED');
        const code = crypto.randomUUID().replaceAll('-', '');
        const result = await ctx.db.batch([
            statement(`INSERT INTO {transfer_intents}(intent_id,bot_id,from_user_id,to_user_id,amount_minor,fee_minor,fee_policy_version,
                created_at_ms,expires_at_ms,origin_message_id,request_hash,confirmation_code)
                SELECT ?,?,?,?,?,?,?,${DATABASE_NOW_MS},${DATABASE_NOW_MS}+?,?,?,?
                FROM {wallet_state} WHERE bot_id=? AND policy_version=? AND qq_transfer_enabled=1
                AND EXISTS(SELECT 1 FROM {accounts} WHERE bot_id=? AND user_id=? AND status='active')
                AND EXISTS(SELECT 1 FROM {accounts} WHERE bot_id=? AND user_id=?)
                ON CONFLICT(intent_id) DO NOTHING RETURNING *`, id, ctx.botId, user, recipient, amount, fee, policy.policy_version, LIMITS.intentLifetimeMs, messageId, hash, code, ctx.botId, policy.policy_version, ctx.botId, user, ctx.botId, recipient)
        ]);
        // 必须等待整批成功；只有未插入时才查询并发赢家。
        const stored = result[0]!.results[0] as unknown as IntentData | undefined;

        if (stored) { return success({ ...stored, status: 'pending' }); }

        const winner = await findIntent(ctx, id);

        return winner.intent_id ? success(await existingIntent(winner, hash)) : failure('BUSY', true);
    } catch (error) {
        return systemFailure(error);
    }
}

export async function executeTransferIntent(ctx: PluginContext, user: string, id: string, code: string, action: 'confirm' | 'cancel'): Promise<Result<OperationReceipt>> {
    try {
        [user, id, code].forEach(identifier);
        const confirming = action === 'confirm';
        // 已有回执、身份不符或已过期时，不命中来源和账户，保持重放与拒绝读取有界。
        const businessBot = `CASE WHEN i.intent_id IS NOT NULL AND o.operation_id IS NULL AND i.expires_at_ms>${DATABASE_NOW_MS} THEN m.bot_id END`;
        const accountBot = `CASE WHEN s.enabled=1 AND ${operationPermissionSql('transfer')} THEN s.bot_id END`;
        const rows = await readReady(ctx, () => ctx.db.all<IntentExecution>(`SELECT m.schema_version,m.format,m.init_state,m.ledger_revision,i.*,${DATABASE_NOW_MS} AS observed_at_ms,o.request_hash AS operation_hash,
            o.status AS operation_status,o.result_json AS operation_result
            ${confirming ? `,s.source,s.enabled,s.operation_permissions,s.read_permissions,s.policy_version,
                ${['sender', 'recipient'].flatMap(alias => ACCOUNT_COLUMNS.map(column => `${alias}.${column} AS ${alias}_${column}`)).join(',')}` : ''}
            FROM {wallet_state} m LEFT JOIN {transfer_intents} i
            ON i.bot_id=m.bot_id AND i.intent_id=? AND i.from_user_id=? AND i.confirmation_code=?
            LEFT JOIN {operations} o ON o.bot_id=i.bot_id AND o.source='points.qq' AND o.operation_id=i.intent_id
            ${confirming ? `LEFT JOIN {sources} s ON s.bot_id=${businessBot} AND s.source='points.qq'
                LEFT JOIN {accounts} sender ON sender.bot_id=${accountBot} AND sender.user_id=i.from_user_id
                LEFT JOIN {accounts} recipient ON recipient.bot_id=${accountBot} AND recipient.user_id=i.to_user_id` : ''}
            WHERE m.bot_id=?`, id, user, code, ctx.botId), value => value[0], true);
        const intent = rows[0];
        requireCondition(intent?.intent_id, 'INVALID_ARGUMENT');
        const input = intentOperation(intent);
        const hash = await requestHash('qq.execute', input);

        if (intent.operation_hash !== null) {
            requireCondition(intent.operation_status && intent.operation_result !== null, 'INTERNAL_ERROR');

            return replay({ request_hash: intent.operation_hash, status: intent.operation_status, result_json: intent.operation_result }, hash);
        }

        requireCondition(intent.expires_at_ms > intent.observed_at_ms, 'CONFIRMATION_EXPIRED');
        const snapshot = emptySnapshot(ctx.botId, { ledger_revision: intent.ledger_revision, now: intent.observed_at_ms });

        if (confirming) {
            snapshot.source = intent.source ? {
                bot_id: ctx.botId, source: intent.source, enabled: intent.enabled,
                operation_permissions: intent.operation_permissions, read_permissions: intent.read_permissions, policy_version: intent.policy_version
            } : null;
            // 一行分别保存双方账户；独立别名避免覆盖意图字段，缺户仍交给原业务校验。
            snapshot.accounts = (['sender', 'recipient'] as const).filter(alias => intent[`${alias}_user_id`]).map(alias => ({
                bot_id: ctx.botId, user_id: intent[`${alias}_user_id`]!, available_minor: intent[`${alias}_available_minor`]!, reserved_minor: intent[`${alias}_reserved_minor`]!,
                status: intent[`${alias}_status`]!, version: intent[`${alias}_version`]!, created_at_ms: intent[`${alias}_created_at_ms`]!, updated_at_ms: intent[`${alias}_updated_at_ms`]!
            }));
        }

        const plan = new LedgerPlan(snapshot, input);
        let rejection: PointsErrorCode | undefined = action === 'cancel' ? 'CONFIRMATION_CANCELLED' : undefined;
        plan.data.conditions.push({ sql: '? <= decision_at_ms', params: [intent.expires_at_ms], error: 'CONFIRMATION_EXPIRED' });

        if (confirming) {
            plan.data.conditions.push({
                sql: 'qq_transfer_enabled<>1', params: [], error: 'TRANSFER_DISABLED'
            });

            try {
                transfer(plan);
                plan.finish();
            } catch (error) {
                if (!(error instanceof PointsFault) || error.retryable || error.code === 'INTERNAL_ERROR') {
                    throw error;
                }

                rejection = error.code;
            }
        }

        return await commit(ctx, input, hash, plan, rejection);
    } catch (error) {
        return systemFailure(error);
    }
}

interface IntentLookup extends IntentData, WalletPolicy {
    schema_version: number;
    format: string;
    init_state: string;
    checked_at_ms: number;
    operation_hash: string | null;
    operation_status: 'committed' | 'rejected' | null;
    operation_code: PointsErrorCode | null;
    operation_result: string | null;
}

async function findIntent(ctx: PluginContext, id: string): Promise<IntentLookup> {
    const row = await readReady(ctx, () => ctx.db.first<IntentLookup>(`SELECT m.schema_version,m.format,m.init_state,
        m.qq_transfer_enabled,m.qq_fee_mode,m.qq_fee_numerator,m.qq_fee_denominator,m.policy_version,i.*,${DATABASE_NOW_MS} AS checked_at_ms,
        o.request_hash AS operation_hash,o.status AS operation_status,o.result_code AS operation_code,o.result_json AS operation_result
        FROM {wallet_state} m LEFT JOIN {transfer_intents} i ON i.bot_id=m.bot_id AND i.intent_id=?
        LEFT JOIN {operations} o ON o.bot_id=i.bot_id AND o.source='points.qq' AND o.operation_id=i.intent_id
        WHERE m.bot_id=?`, id, ctx.botId), value => value);
    requireCondition(row, 'INTERNAL_ERROR');

    return row;
}

async function existingIntent(row: IntentLookup, hash: string): Promise<TransferIntent> {
    requireCondition(row.request_hash === hash, 'OPERATION_CONFLICT');
    const { schema_version, format, init_state, checked_at_ms, qq_transfer_enabled, qq_fee_mode, qq_fee_numerator,
        qq_fee_denominator, policy_version, operation_hash, operation_status, operation_code, operation_result, ...intent } = row;
    requireCondition(operation_hash === null || operation_status === 'committed' || operation_status === 'rejected', 'INTERNAL_ERROR');

    if (operation_hash === null) {
        requireCondition(intent.expires_at_ms > checked_at_ms, 'CONFIRMATION_EXPIRED');

        return { ...intent, status: 'pending' };
    }

    requireCondition(operation_status && operation_result !== null, 'INTERNAL_ERROR');
    const status = operation_status === 'committed' ? 'committed'
        : operation_code === 'CONFIRMATION_CANCELLED' ? 'cancelled' : operation_code === 'CONFIRMATION_EXPIRED' ? 'expired' : 'rejected';
    const executionHash = await requestHash('qq.execute', intentOperation(intent));

    return { ...intent, status, result: replay({ request_hash: operation_hash, status: operation_status, result_json: operation_result }, executionHash) };
}

function intentOperation(intent: IntentData) {
    return {
        source: 'points.qq', operationId: intent.intent_id, referenceId: intent.intent_id,
        fromUserId: intent.from_user_id, toUserId: intent.to_user_id, amountMinor: intent.amount_minor, feeMinor: intent.fee_minor
    };
}
