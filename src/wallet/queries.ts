import type { PluginContext } from '@qqbot/sdk';
import type { PointsService, ReservationSnapshot, ReservationState, TransactionPage, TransactionSummary } from '../contracts.js';
import type { AccountRow, ReservationRow, SourceRow } from './model.js';
import { balance } from './model.js';
import { readReady } from './storage/schema.js';
import { identifier, lookup, readReadyOperation, sourceId } from './ledger/operations.js';
import { requireCondition, success, systemFailure } from './errors.js';
import { placeholders, statement } from './storage/sql.js';
import { DATABASE_NOW_MS, beijingMonth } from './time.js';
import { pick } from './input.js';
import { LIMITS } from './limits.js';
import { reservationProjection, reservationRows } from './reservation-queries.js';

function readable(source: Pick<SourceRow, 'enabled' | 'read_permissions'> | undefined, permission: string): void {
    requireCondition(source, 'SOURCE_NOT_REGISTERED');
    requireCondition(source.enabled === 1, 'SOURCE_DISABLED');
    requireCondition((JSON.parse(source.read_permissions) as string[]).includes(permission), 'SOURCE_NOT_ALLOWED');
}

export function queries(ctx: PluginContext, internal = false): Pick<PointsService, 'checkAccounts' | 'getSourcePolicy' | 'getBalance' | 'getTransactions' | 'getOperation' | 'getReservations'> {
    return {
        async getSourcePolicy(input) {
            try {
                const source = sourceId(pick(input, ['source']).source);
                const row = await readReady(ctx, () => ctx.db.first<SourceRow>(`SELECT m.schema_version,m.format,m.init_state,s.*
                    FROM {wallet_state} m LEFT JOIN {sources} s ON s.bot_id=m.bot_id AND s.source=? WHERE m.bot_id=?`, source, ctx.botId), value => value);

                return success(row?.source ? {
                    source, registered: true as const, enabled: row.enabled === 1,
                    operationPermissions: JSON.parse(row.operation_permissions) as string[],
                    readPermissions: JSON.parse(row.read_permissions) as string[], policyVersion: row.policy_version
                }
                    : { source, registered: false as const });
            } catch (error) { return systemFailure(error); }
        },
        async checkAccounts(input) {
            try {
                const value = pick(input, ['source', 'userIds']);
                const source = sourceId(value.source);
                const ids = value.userIds;
                requireCondition(Array.isArray(ids) && ids.length > 0, 'INVALID_ARGUMENT');
                requireCondition(ids.length <= LIMITS.accounts, 'LIMIT_EXCEEDED');
                ids.forEach(identifier);
                requireCondition(new Set(ids).size === ids.length, 'INVALID_ARGUMENT');

                // 同一次快照校验来源并逐个按主键查户，避免批量 IN 的中间读行。
                const row = await readReady(ctx, () => ctx.db.first<{ source: string | null; enabled: number; found_json: string }>(`SELECT m.schema_version,m.format,m.init_state,s.source,s.enabled,
                    json_array(${ids.map(() => `(SELECT a.user_id FROM {accounts} a
                        WHERE a.bot_id=CASE WHEN s.enabled=1 THEN m.bot_id END AND a.user_id=?)`).join(',')}) AS found_json
                    FROM {wallet_state} m LEFT JOIN {sources} s ON s.bot_id=m.bot_id AND s.source=?
                    WHERE m.bot_id=?`, ...ids, source, ctx.botId), value => value);
                requireCondition(row?.source, 'SOURCE_NOT_REGISTERED');
                requireCondition(row!.enabled === 1, 'SOURCE_DISABLED');
                const found = new Set(JSON.parse(row!.found_json) as (string | null)[]);
                const accounts = ids.map(userId => ({ userId: userId as string, exists: found.has(userId as string) }));

                return success({
                    accounts, ...(accounts.some(account => !account.exists)
                        ? { openingHint: '请未开户用户本人私聊机器人发送 /积分 开户' } : {})
                });
            } catch (error) { return systemFailure(error); }
        },
        async getBalance(input) {
            try {
                sourceId(input.source, internal);
                identifier(input.userId);
                const row = await readReady(ctx, () => ctx.db.first<AccountRow & Pick<SourceRow, 'source' | 'enabled' | 'read_permissions'>>(`SELECT m.schema_version,m.format,m.init_state,a.*,s.source,s.enabled,s.read_permissions
                    FROM {wallet_state} m LEFT JOIN {sources} s ON s.bot_id=m.bot_id AND s.source=?
                    LEFT JOIN {accounts} a ON a.bot_id=CASE WHEN s.enabled=1
                        AND (json_extract(s.read_permissions,'$[0]')='balance' OR json_extract(s.read_permissions,'$[1]')='balance')
                        THEN s.bot_id END AND a.user_id=? WHERE m.bot_id=?`, input.source, input.userId, ctx.botId), value => value);
                readable(row?.source ? row : undefined, 'balance');
                requireCondition(row?.user_id, 'ACCOUNT_NOT_FOUND');
                const account = row;

                return success(balance(account));
            } catch (error) {
                return systemFailure(error);
            }
        },
        async getOperation(input) {
            try {
                sourceId(input.source, internal);
                identifier(input.operationId);

                return lookup(await readReadyOperation(ctx, input.source, input.operationId));
            } catch (error) {
                return systemFailure(error);
            }
        },
        async getReservations(input) {
            try {
                sourceId(input.source, internal);
                const funds = input.reservationIds;
                requireCondition(Object.keys(input).every(key => ['source', 'reservationIds'].includes(key)), 'INVALID_ARGUMENT');
                requireCondition(Array.isArray(funds) && funds.length > 0, 'INVALID_ARGUMENT');
                requireCondition(funds.length <= LIMITS.reservations, 'LIMIT_EXCEEDED');
                requireCondition(new Set(funds).size === funds.length, 'INVALID_ARGUMENT');
                funds.forEach(identifier);
                const packed = funds.length > 1;
                const rows = await readReady(ctx, () => ctx.db.all<Record<string, unknown> & {
                    observed_at_ms: number;
                }>(`SELECT m.schema_version,m.format,m.init_state,${DATABASE_NOW_MS} AS observed_at_ms,
                    ${packed ? reservationProjection('m.bot_id', '?', funds) : 'r.*'} FROM {wallet_state} m
                    ${packed ? '' : `LEFT JOIN {reservations} r ON r.bot_id=m.bot_id AND r.source=? AND r.reservation_id IN (${placeholders(funds)})`}
                    WHERE m.bot_id=?`, ...(packed ? funds.flatMap(id => [input.source, id]) : [input.source, ...funds]), ctx.botId), value => value[0]);
                const observedAtMs = rows[0]!.observed_at_ms;
                const byId = new Map(reservationRows(rows).map(row => [row.reservation_id, row]));
                const data: ReservationSnapshot = {
                    observedAtMs,
                    funds: funds.map(reservationId => {
                        const row = byId.get(reservationId);

                        return { reservationId, record: row ? { ...reservationState(row, observedAtMs), userId: row.user_id } : null };
                    })
                };

                return success(data);
            } catch (error) {
                return systemFailure(error);
            }
        },
        async getTransactions(input) {
            try {
                sourceId(input.source, internal);
                identifier(input.userId);
                const limit = input.limit ?? 20;
                requireCondition(Number.isInteger(limit) && limit >= 1 && limit <= LIMITS.pageSize, 'LIMIT_EXCEEDED');
                const cursor = input.cursor ? decodeCursor(input.cursor) : null;
                requireCondition(!cursor || (cursor.bot === ctx.botId && cursor.source === input.source && cursor.user === input.userId), 'INVALID_ARGUMENT');
                const result = await readReady(ctx, () => ctx.db.batch([
                    statement(`SELECT schema_version,format,init_state,${DATABASE_NOW_MS} AS now,ledger_revision FROM {wallet_state} WHERE bot_id=?`, ctx.botId),
                    statement('SELECT s.*,EXISTS(SELECT 1 FROM {accounts} a WHERE a.bot_id=s.bot_id AND a.user_id=?) AS account_exists FROM {sources} s WHERE s.bot_id=? AND s.source=?', input.userId, ctx.botId, input.source),
                    statement(`SELECT i.tx_id,i.source,i.operation_id,i.type,i.created_at_ms,i.reference_id,i.reverses_tx_id,i.compensates_tx_id,
                        i.reason,a.available_delta_minor,a.reserved_delta_minor FROM {transaction_accounts} a
                        CROSS JOIN {transactions} i ON i.tx_id=a.tx_id
                        WHERE a.bot_id=? AND a.user_id=? AND a.month_bjt=strftime('%Y-%m','now','+8 hours')
                        AND a.commit_revision<=COALESCE(?,(SELECT ledger_revision FROM {wallet_state} WHERE bot_id=?))
                        AND (a.created_at_ms,a.tx_id)<(?,?) ORDER BY a.created_at_ms DESC,a.tx_id DESC LIMIT ?`, ctx.botId, input.userId, cursor?.revision ?? null, ctx.botId, cursor?.time ?? Number.MAX_SAFE_INTEGER, cursor?.tx ?? '', limit + 1)
                ]), value => value[0]!.results[0]);
                readable(result[1]!.results[0] as unknown as SourceRow | undefined, 'transactions');
                requireCondition(result[1]!.results[0]!.account_exists === 1, 'ACCOUNT_NOT_FOUND');
                const month = beijingMonth(result[0]!.results[0]!.now as number);
                requireCondition((input.month === undefined || input.month === month) && (!cursor || cursor.month === month), 'INVALID_ARGUMENT');
                const rows = result[2]!.results;
                const items = rows.slice(0, limit).map(summary);
                const last = rows[limit - 1];
                const data: TransactionPage = { month, items };

                if (rows.length > limit && last) {
                    data.nextCursor = encodeURIComponent(JSON.stringify({
                        bot: ctx.botId, source: input.source, user: input.userId,
                        month, revision: cursor?.revision ?? result[0]!.results[0]!.ledger_revision, time: last.created_at_ms, tx: last.tx_id
                    }));
                }

                return success(data);
            } catch (error) {
                return systemFailure(error);
            }
        }
    };
}

interface Cursor {
    bot: string;
    source: string;
    user: string;
    month: string;
    revision: number;
    time: number;
    tx: string;
}

function decodeCursor(value: string): Cursor {
    requireCondition(typeof value === 'string' && value.length <= 2048, 'INVALID_ARGUMENT');
    let data: Cursor;

    try {
        data = JSON.parse(decodeURIComponent(value)) as Cursor;
    } catch {
        requireCondition(false, 'INVALID_ARGUMENT');
    }

    requireCondition(data !== null && typeof data === 'object' && Number.isSafeInteger(data.revision)
        && data.revision >= 0 && Number.isSafeInteger(data.time) && data.time >= 0 && typeof data.month === 'string', 'INVALID_ARGUMENT');
    identifier(data.tx);

    return data;
}

export function summary(row: Record<string, unknown>): TransactionSummary {
    return {
        transactionId: row.tx_id as string, source: row.source as string, operationId: row.operation_id as string,
        type: row.type as TransactionSummary['type'], createdAtMs: row.created_at_ms as number,
        availableDeltaMinor: row.available_delta_minor as number, reservedDeltaMinor: row.reserved_delta_minor as number,
        ...(row.reference_id ? { referenceId: row.reference_id as string } : {}),
        ...(row.reason ? { reason: row.reason as string } : {}),
        ...(row.reverses_tx_id ? { reversesTransactionId: row.reverses_tx_id as string } : {}),
        ...(row.compensates_tx_id ? { compensatesTransactionId: row.compensates_tx_id as string } : {})
    };
}

function reservationState(row: ReservationRow, observedAtMs: number): ReservationState {
    return {
        referenceId: row.reference_id, amountMinor: row.amount_minor, status: row.status, expiresAtMs: row.expires_at_ms,
        effectiveActive: row.status === 'active' && row.expires_at_ms > observedAtMs,
        createdOperationId: row.created_operation_id, lastOperationId: row.last_operation_id, lastOperationSource: row.last_operation_source,
        ...(row.terminal_operation_id ? {
            terminalOperationId: row.terminal_operation_id,
            terminalOperationSource: row.terminal_operation_source!, ...(row.consumed_tx_id ? { terminalTransactionId: row.consumed_tx_id } : {})
        } : {})
    };
}
