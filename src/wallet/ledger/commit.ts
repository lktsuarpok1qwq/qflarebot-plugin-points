import type { DBStatement, PluginContext } from '@qqbot/sdk';
import type { OperationReceipt, PointsErrorCode, Result } from '../../contracts.js';
import { failure } from '../errors.js';
import type { Input } from '../input.js';
import type { LedgerPlan } from './plan.js';
import { balance } from '../model.js';
import { requireLedger } from './ledger.js';
import { DECISION_TIME_SQL, WALLET_READY } from '../storage/schema.js';
import { statement } from '../storage/sql.js';
import { beijingDate, beijingMonth } from '../time.js';
import { LIMITS } from '../limits.js';
import type { OperationRow } from './operations.js';
import { replay } from './operations.js';

const TABLE_KEYS: Record<string, string[]> = {
    accounts: ['bot_id', 'user_id'], reservations: ['bot_id', 'source', 'reservation_id'],
};

export function upsertRows(table: string, values: object[], guard: string): DBStatement[] {
    if (!values.length) {
        return [];
    }

    const keys = TABLE_KEYS[table];

    if (!keys) {
        throw new Error('Unsupported ledger table');
    }

    // 单行让 VALUES 保持协程并直接连接守卫；多行使用常量子查询，
    // 避免为连接而物化 VALUES 或逐行重读钱包，读量不随批量规模放大。
    const single = values.length === 1;
    const time = single ? 'guard.guard_time' : `(${guard})`;
    const from = single ? `FROM rows CROSS JOIN (${guard}) AS guard WHERE 1` : `FROM rows WHERE EXISTS(${guard})`;
    const columns = Object.keys(values[0]!);
    const expressions = columns.map(column => {
        const value = `json_extract(value,'$.${column}')`;

        if (['created_at_ms', 'updated_at_ms', 'renewed_at_ms'].includes(column)) {
            return `CASE WHEN ${value}=0 THEN ${time} ELSE ${value} END`;
        }

        if (column === 'status' && table === 'reservations') {
            return `CASE WHEN ${value}='released' AND json_extract(value,'$.expires_at_ms')<=${time} THEN 'expired' ELSE ${value} END`;
        }

        if (column === 'renewal_deadline_ms') {
            return `CASE WHEN ${value}=0 THEN ${time}+${LIMITS.reservationLifetimeMs} ELSE ${value} END`;
        }

        return value;
    });

    // 每个已验证的行使用一个 JSON 绑定值，批量执行时不递归展开数组。
    return [statement(`WITH rows(value) AS (VALUES ${values.map(() => "(?)").join(",")}) INSERT INTO {${table}}(${columns.join(',')})
        SELECT ${expressions.join(',')} ${from}
        ON CONFLICT(${keys.join(',')}) DO UPDATE SET ${columns.filter(c => !keys.includes(c)).map(c => `${c}=excluded.${c}`).join(',')}`, ...values.map(value => JSON.stringify(value)))];
}

export async function commit(ctx: Pick<PluginContext, 'db' | 'botId'>, input: Input, hash: string, builder: LedgerPlan, rejection?: PointsErrorCode, extra?: (gate: string) => DBStatement[]): Promise<Result<OperationReceipt>> {
    const plan = builder.data;
    const snapshot = builder.snapshot;

    const token = rejection ? null : crypto.randomUUID();
    const tokenWhere = `bot_id='${ctx.botId.replaceAll("'", "''")}' AND guard_token='${token}'`;
    // 状态写入从成功守卫取得许可和同一决策时间；单行连接避免重复查询。
    const guard = `SELECT guard_time FROM {wallet_state} WHERE ${tokenWhere} AND guard_code IS NULL`;
    const gate = `EXISTS(${guard})`;
    const time = 'guard.guard_time';
    const transactionId = plan.entries.length && !rejection ? crypto.randomUUID() : null;

    const conditions = [...new Map(plan.conditions.map(c => [c.sql + JSON.stringify(c.params), c])).values()];
    const resultCodes = new Set<PointsErrorCode>(conditions.map(c => c.error));

    if (rejection) {
        resultCodes.add(rejection);
    }

    const errors = Object.fromEntries([...resultCodes].map(code => [code, failure(code)]));
    const receipt: Omit<OperationReceipt, 'committedAtMs'> = {
        operationId: input.operationId,
        ...(transactionId ? { transactionId } : {}),
        ...(plan.reservationIds.length ? { reservationIds: plan.reservationIds } : {}),
        ...(plan.accounts.length ? { balancesAtCommit: plan.accounts.map(balance) } : {})
    };

    const codeSql = conditions.length ? `CASE ${conditions.map(c => `WHEN ${c.sql} THEN '${c.error}'`).join(' ')} ELSE ? END` : '?';
    const policy = plan.walletPolicy;
    // 同一套资格条件用于决策和目标更新；不再额外读取物化的 decision 判断是否存在。
    // SQLite 的 now 在同一语句中保持一致，到期维护的下界也参与两处相同判断。
    const eligible = (decisionTime: string) => `bot_id=? AND ledger_revision=?
        AND strftime('%Y-%m-%d','now','+8 hours')=?
        AND NOT EXISTS(SELECT 1 FROM {operations} WHERE bot_id=? AND source=? AND operation_id=?)
        ${plan.notBeforeMs === undefined ? '' : `AND ${decisionTime}>=?`}`;
    const eligibleParams = [ctx.botId, snapshot.revision, beijingDate(snapshot.now), ctx.botId, input.source, input.operationId,
    ...(plan.notBeforeMs === undefined ? [] : [plan.notBeforeMs])];
    const decision = `WITH decision(token,decision_at_ms,schema_ready,result_code) AS MATERIALIZED (
        SELECT ?,decision_at_ms,CASE WHEN ${WALLET_READY} THEN 1 ELSE 0 END,${codeSql}
        FROM (SELECT *,${DECISION_TIME_SQL} AS decision_at_ms FROM {wallet_state}) decision
        WHERE ${eligible('decision_at_ms')})`;
    const decisionParams = [token, ...conditions.flatMap(c => c.params), rejection ?? null, ...eligibleParams];
    const statements: DBStatement[] = [];

    if (rejection) {
        // 已确定拒绝只保存永久回执，事务内的期限条件仍优先于预读拒绝。
        // 格式错误时故意触发 request_hash 的 NOT NULL，整批失败且不更新钱包守卫。
        statements.push(statement(`${decision}
            INSERT INTO {operations}(bot_id,source,operation_id,request_hash,status,result_code,result_json,transaction_id,reason,created_at_ms)
            SELECT ?,?,?,CASE WHEN schema_ready=1 THEN ? END,'rejected',result_code,
                json_extract(?, '$.' || result_code),NULL,?,decision_at_ms FROM decision`,
            ...decisionParams, ctx.botId, input.source, input.operationId, hash, JSON.stringify(errors), input.reason ?? null));
    } else {
        // 成功候选仍一次更新守卫、修订和钱包政策，后续写入只认可本次随机凭据。
        statements.push(statement(`${decision}
            UPDATE {wallet_state} SET (guard_token,guard_time,guard_ready,guard_code,ledger_revision
                ${policy ? ',qq_transfer_enabled,qq_fee_mode,qq_fee_numerator,qq_fee_denominator,policy_version' : ''})=
            (SELECT token,decision_at_ms,schema_ready,result_code,ledger_revision+CASE WHEN result_code IS NULL THEN 1 ELSE 0 END
                ${policy ? ',CASE WHEN result_code IS NULL THEN ? ELSE qq_transfer_enabled END,CASE WHEN result_code IS NULL THEN ? ELSE qq_fee_mode END,CASE WHEN result_code IS NULL THEN ? ELSE qq_fee_numerator END,CASE WHEN result_code IS NULL THEN ? ELSE qq_fee_denominator END,policy_version+CASE WHEN result_code IS NULL THEN 1 ELSE 0 END' : ''}
                FROM decision)
            WHERE ${eligible(DECISION_TIME_SQL)}`, ...decisionParams,
            ...(policy ? [Number(policy.enabled), policy.feeMode, policy.numerator, policy.denominator] : []), ...eligibleParams));
    }

    if (!rejection) {
        for (const row of plan.funds) {
            if (row.terminal_operation_id === input.operationId) {
                row.consumed_tx_id = transactionId;
            }
        }

        statements.push(...upsertRows('accounts', plan.accounts, guard));

        if (plan.renewal) {
            const row = plan.renewal;
            statements.push(statement(`UPDATE {reservations} SET expires_at_ms=?,renewed_at_ms=${time},
                last_operation_id=?,last_operation_source=? FROM (${guard}) AS guard
                WHERE bot_id=? AND source=? AND reservation_id=?`, row.expires_at_ms, row.last_operation_id, row.last_operation_source, row.bot_id, row.source, row.reservation_id));
        } else {
            statements.push(...upsertRows('reservations', plan.funds, guard));
        }

        if (transactionId) {
            const ledger = {
                entries: plan.entries.map((entry, entryNo) => ({ ...entry, entryNo })),
                minted: builder.minted, burned: builder.burned, transferred: builder.transferred,
                reversalMint: builder.reversalMint, reversalBurn: builder.reversalBurn
            };
            const ledgerJson = JSON.stringify(ledger);
            requireLedger(ledgerJson, plan.entries.length);
            statements.push(statement(`INSERT INTO {transactions}(tx_id,bot_id,source,operation_id,type,reference_id,
                reverses_tx_id,compensates_tx_id,created_at_ms,date_bjt,month_bjt,commit_revision,ledger_json,reason,expected_entry_count)
                SELECT ?,?,?,?,?,?,?,?,${time},?,?,?,?,?,? FROM (${guard}) AS guard`, transactionId, ctx.botId, input.source, input.operationId, plan.type, input.referenceId ?? null, plan.reversal ?? null, plan.compensation ?? null, beijingDate(snapshot.now), beijingMonth(snapshot.now), snapshot.revision + 1, ledgerJson, input.reason ?? null, plan.entries.length));
            // LedgerPlan 对用户去重；在写入唯一交易的同一受保护批次中，每个用户仅追加一条流水，
            // 时间和月份须与交易一致，且不可修改。
            const accounts = plan.accounts.map(account => {
                const entries = plan.entries.filter(entry => entry.bucket !== 'supply' && entry.accountId === account.user_id);

                return {
                    user: account.user_id, available: entries.filter(e => e.bucket === 'available').reduce((s, e) => s + e.deltaMinor, 0),
                    reserved: entries.filter(e => e.bucket === 'reserved').reduce((s, e) => s + e.deltaMinor, 0)
                };
            });
            const single = accounts.length === 1;
            const accountTime = single ? time : `(${guard})`;
            const from = single ? `FROM rows CROSS JOIN (${guard}) AS guard` : `FROM rows WHERE EXISTS(${guard})`;
            statements.push(statement(`WITH rows(value) AS (VALUES ${accounts.map(() => "(?)").join(",")}) INSERT INTO {transaction_accounts}
                (tx_id,bot_id,user_id,month_bjt,created_at_ms,commit_revision,available_delta_minor,reserved_delta_minor)
                SELECT ?,?,json_extract(value,'$.user'),?,${accountTime},?,json_extract(value,'$.available'),json_extract(value,'$.reserved')
                ${from}`, ...accounts.map(value => JSON.stringify(value)), transactionId, ctx.botId, beijingMonth(snapshot.now), snapshot.revision + 1));
        }

        if (extra) {
            statements.push(...extra(gate));
        }

        statements.push(statement(`INSERT INTO {operations}(bot_id,source,operation_id,request_hash,status,result_code,result_json,transaction_id,reason,created_at_ms)
        SELECT bot_id,?,?,?,CASE WHEN guard_code IS NULL THEN 'committed' ELSE 'rejected' END,guard_code,
        CASE WHEN guard_code IS NULL THEN json_object('ok',json('true'),'data',json_patch(?,json_object('committedAtMs',guard_time)))
        ELSE json_extract(?, '$.' || guard_code) END,CASE WHEN guard_code IS NULL THEN ? ELSE NULL END,?,guard_time
        FROM {wallet_state} WHERE ${tokenWhere}`, input.source, input.operationId, hash, JSON.stringify(receipt), JSON.stringify(errors), transactionId, input.reason ?? null));
    }

    // 在同一原子批次中按永久键读取最终结果，也能恢复先提交的并发赢家。
    const receiptIndex = statements.length;
    statements.push(statement('SELECT request_hash,status,result_json FROM {operations} WHERE bot_id=? AND source=? AND operation_id=?', ctx.botId, input.source, input.operationId));
    const result = await ctx.db.batch(statements);
    // 钱包行保留最近凭据，无需额外清理；仍须等待整个原子批次成功才发布回执。
    const row = result[receiptIndex]!.results[0] as unknown as OperationRow | undefined;

    return row ? replay(row, hash) : failure('BUSY', true);
}
