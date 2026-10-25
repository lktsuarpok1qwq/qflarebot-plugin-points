import type { DBStatement, PluginContext } from '@qqbot/sdk';
import type { OperationContext, OperationReceipt, PointsErrorCode, Result } from '../contracts.js';
import { operationContext, replay, requestHash, sourceId } from './ledger/operations.js';
import { requireCondition, success, systemFailure } from './errors.js';
import { minor } from './amounts.js';
import { readReady } from './storage/schema.js';
import { emptySnapshot } from './ledger/snapshot.js';
import { DATABASE_NOW_MS } from './time.js';
import { LedgerPlan } from './ledger/plan.js';
import { commit } from './ledger/commit.js';
import { statement } from './storage/sql.js';
import type { Plan } from './model.js';
import type { Input } from './input.js';
import { pick } from './input.js';

export const OPERATION_PERMISSIONS = ['burn', 'transfer', 'reserve', 'renew', 'release', 'settle',
    'reverseOwn'] as const;
export interface SourcePolicy {
    source: string;
    enabled: boolean;
    operationPermissions: string[];
    readPermissions: string[];
}
export interface WalletPolicy {
    bot_id: string;
    qq_transfer_enabled: number;
    qq_fee_mode: 'free' | 'proportional';
    qq_fee_numerator: number;
    qq_fee_denominator: number;
    policy_version: number;
}
interface PolicyRequest extends Omit<OperationContext, 'source'> {
    expectedVersion: number | null;
}

export async function registerSource(ctx: PluginContext, input: { source: string }): Promise<Result<{ source: string }>> {
    try {
        const source = sourceId(pick(input, ['source']).source);
        const existing = await readReady(ctx, () => ctx.db.first<{ source: string | null }>(`SELECT m.schema_version,m.format,m.init_state,s.source
            FROM {wallet_state} m LEFT JOIN {sources} s ON s.bot_id=m.bot_id AND s.source=? WHERE m.bot_id=?`, source, ctx.botId), value => value, true);

        // 自然键已经存在时只读返回，不触碰钱包修订号或管理员已设置的权限。
        if (existing!.source !== null) { return success({ source }); }

        // 在同一事务内，仅首次插入使登记前的政策快照失效；
        // 不更新已有来源，包括管理员已禁用的来源。
        await ctx.db.batch([
            statement(`UPDATE {wallet_state} SET ledger_revision=ledger_revision+1 WHERE bot_id=?
                AND NOT EXISTS(SELECT 1 FROM {sources} WHERE bot_id=? AND source=?)`, ctx.botId, ctx.botId, source),
            statement(`INSERT INTO {sources}(bot_id,source,enabled,operation_permissions,read_permissions,policy_version)
                VALUES(?,?,0,'[]','[]',0) ON CONFLICT(bot_id,source) DO NOTHING`, ctx.botId, source)
        ]);

        return success({ source });
    } catch (error) {
        const result = systemFailure(error);

        return result.retryable ? { ...result, message: '来源登记结果尚未确认，请使用相同来源标识重试' } : result;
    }
}

export async function setSourcePolicy(ctx: PluginContext, input: PolicyRequest & {
    policy: SourcePolicy;
}): Promise<Result<OperationReceipt>> {
    try {
        pick(input, ['operationId', 'reason', 'referenceId', 'expectedVersion', 'policy']);
        const policy = pick(input.policy, ['source', 'enabled', 'operationPermissions', 'readPermissions']) as unknown as SourcePolicy;
        sourceId(policy.source, true);
        requireCondition(Object.keys(policy).every(key => ['source', 'enabled', 'operationPermissions', 'readPermissions'].includes(key)), 'INVALID_ARGUMENT');
        requireCondition(!['points.qq', 'points.system'].includes(policy.source), 'SOURCE_NOT_ALLOWED');
        requireCondition(typeof policy.enabled === 'boolean', 'INVALID_ARGUMENT');
        requireCondition(Array.isArray(policy.operationPermissions) && policy.operationPermissions.length <= OPERATION_PERMISSIONS.length
            && policy.operationPermissions.every(value => OPERATION_PERMISSIONS.includes(value as typeof OPERATION_PERMISSIONS[number]))
            && new Set(policy.operationPermissions).size === policy.operationPermissions.length, 'INVALID_ARGUMENT');
        requireCondition(Array.isArray(policy.readPermissions) && policy.readPermissions.length <= 2
            && policy.readPermissions.every(value => ['balance', 'transactions'].includes(value))
            && new Set(policy.readPermissions).size === policy.readPermissions.length, 'INVALID_ARGUMENT');
        const normalized = {
            ...input, policy: {
                ...policy, operationPermissions: [...policy.operationPermissions].sort(),
                readPermissions: [...policy.readPermissions].sort()
            }
        };

        return await policyChange(ctx, 'source', normalized, policy.source, (gate) => [statement(`INSERT INTO {sources}
                (bot_id,source,enabled,operation_permissions,read_permissions,policy_version)
                SELECT ?,?,?,?,?,? WHERE ${gate} ON CONFLICT(bot_id,source) DO UPDATE SET enabled=excluded.enabled,
                operation_permissions=excluded.operation_permissions,read_permissions=excluded.read_permissions,policy_version=excluded.policy_version`, ctx.botId, policy.source, Number(policy.enabled), JSON.stringify(normalized.policy.operationPermissions), JSON.stringify(normalized.policy.readPermissions), (input.expectedVersion ?? -1) + 1)]);
    } catch (error) {
        return systemFailure(error);
    }
}

export async function setWalletPolicy(ctx: PluginContext, input: PolicyRequest & {
    enabled: boolean;
    feeMode: 'free' | 'proportional';
    numerator: number;
    denominator: number;
}): Promise<Result<OperationReceipt>> {
    try {
        pick(input, ['operationId', 'reason', 'referenceId', 'expectedVersion', 'enabled', 'feeMode', 'numerator', 'denominator']);
        requireCondition(typeof input.enabled === 'boolean' && ['free', 'proportional'].includes(input.feeMode), 'INVALID_ARGUMENT');
        minor(input.numerator, true);
        minor(input.denominator);

        return await policyChange(ctx, 'wallet', input, null, undefined, input);
    } catch (error) {
        return systemFailure(error);
    }
}

async function policyChange(ctx: PluginContext, kind: 'source' | 'wallet', request: PolicyRequest, policySource: string | null, writes?: (gate: string) => DBStatement[], walletPolicy?: Plan['walletPolicy']): Promise<Result<OperationReceipt>> {
    const input = { ...request, source: 'admin', action: 'policy.' + kind } as Input;
    operationContext(input, true);
    requireCondition(typeof input.reason === 'string' && input.reason.trim().length > 0, 'INVALID_ARGUMENT');
    requireCondition(request.expectedVersion === null || (Number.isSafeInteger(request.expectedVersion)
        && request.expectedVersion >= 0 && request.expectedVersion < Number.MAX_SAFE_INTEGER), 'INVALID_ARGUMENT');
    const hash = await requestHash('admin.policy.' + kind, input);
    const previous = await readReady(ctx, () => ctx.db.first<Record<string, unknown>>(`SELECT m.schema_version,m.format,m.init_state,m.ledger_revision,
        ${DATABASE_NOW_MS} AS now,${kind === 'source' ? 's' : 'm'}.policy_version,
        o.request_hash AS operation_hash,o.status AS operation_status,o.result_json AS operation_result
        FROM {wallet_state} m LEFT JOIN {operations} o ON o.bot_id=m.bot_id AND o.source='admin' AND o.operation_id=?
        ${kind === 'source' ? 'LEFT JOIN {sources} s ON s.bot_id=CASE WHEN o.operation_id IS NULL THEN m.bot_id END AND s.source=?' : ''}
        WHERE m.bot_id=?`, input.operationId, ...(kind === 'source' ? [policySource] : []), ctx.botId), value => value, true);

    if (previous!.operation_hash !== null) {
        return replay({ request_hash: previous!.operation_hash as string, status: previous!.operation_status as 'committed' | 'rejected', result_json: previous!.operation_result as string }, hash);
    }

    const snapshot = emptySnapshot(ctx.botId, previous!);
    const rejection: PointsErrorCode | undefined = (previous?.policy_version ?? null) !== request.expectedVersion ? 'POLICY_VERSION_CONFLICT' : undefined;
    const plan = new LedgerPlan(snapshot, input);
    plan.data.walletPolicy = walletPolicy;

    return commit(ctx, input, hash, plan, rejection, writes);
}
