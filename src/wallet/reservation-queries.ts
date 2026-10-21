import type { DBStatement, PluginContext } from '@qqbot/sdk';
import { requireCondition } from './errors.js';
import { identifier } from './ledger/operations.js';
import { DATABASE_NOW_MS } from './time.js';
import type { FundRow } from './model.js';
import { LIMITS } from './limits.js';
import { placeholders, statement } from './storage/sql.js';
import { readReady } from './storage/schema.js';

const RESERVATION_COLUMNS = ['reservation_id', 'user_id', 'bot_id', 'source', 'reference_id', 'amount_minor', 'status',
    'created_at_ms', 'expires_at_ms', 'renewed_at_ms', 'renewal_deadline_ms', 'policy_version', 'recovery_permissions',
    'created_operation_id', 'last_operation_id', 'last_operation_source', 'terminal_operation_id', 'terminal_operation_source', 'consumed_tx_id'];

// SQL 片段仅来自内部调用；每笔使用十九项数组，避免字段键值对超过 D1 函数参数上限。
export function reservationProjection(bot: string, source: string, ids: unknown[]): string {
    return `json_array(${ids.map(() => `json((SELECT json_array(${RESERVATION_COLUMNS.map(column => 'r.' + column).join(',')})
        FROM {reservations} r WHERE r.bot_id=${bot} AND r.source=${source} AND r.reservation_id=?))`).join(',')}) AS funds_json`;
}

export function reservationRead(bot: string, source: string, ids: unknown[]): DBStatement {
    // 超限输入保持有界读取，由原业务层持久化拒绝；单笔不增加打包和解码。
    return ids.length > 1 && ids.length <= LIMITS.reservations
        ? statement('SELECT ' + reservationProjection('?', '?', ids), ...ids.flatMap(id => [bot, source, id]))
        : statement(`SELECT * FROM {reservations} WHERE bot_id=? AND source=? AND reservation_id IN (${placeholders(ids)})`, bot, source, ...ids);
}

export function reservationRows(rows: Record<string, unknown>[]): FundRow[] {
    return rows.flatMap(row => 'funds_json' in row
        ? (JSON.parse(row.funds_json as string) as (unknown[] | null)[]).filter((fund): fund is unknown[] => fund !== null)
            .map(fund => Object.fromEntries(RESERVATION_COLUMNS.map((column, index) => [column, fund[index]])) as unknown as FundRow)
        : row.reservation_id ? [row as unknown as FundRow] : []);
}

interface ReservationCursor {
    bot: string;
    time: number;
    id: string;
    source: string;
}

// 实时工作列表；释放或续期后需要刷新，不作为账本快照。
export async function reservationWorklist(ctx: PluginContext, encodedCursor?: string) {
    let cursor: ReservationCursor | undefined;

    if (encodedCursor !== undefined) {
        requireCondition(encodedCursor.length <= 2048, 'INVALID_ARGUMENT');

        try {
            cursor = JSON.parse(decodeURIComponent(encodedCursor));
        } catch {
            requireCondition(false, 'INVALID_ARGUMENT');
        }

        requireCondition(cursor && cursor.bot === ctx.botId && Number.isSafeInteger(cursor.time) && cursor.time >= 0, 'INVALID_ARGUMENT');
        identifier(cursor.id);
        identifier(cursor.source);
    }

    const result = await readReady(ctx, () => ctx.db.all<Record<string, unknown>>(`SELECT m.schema_version,m.format,m.init_state,r.*,${DATABASE_NOW_MS} AS observed_at_ms
        FROM {wallet_state} m LEFT JOIN {reservations} r ON r.bot_id=m.bot_id
        AND r.status='active' AND (r.expires_at_ms,r.reservation_id,r.source)>(?,?,?)
        WHERE m.bot_id=? ORDER BY r.expires_at_ms,r.reservation_id,r.source LIMIT 16`,
        cursor?.time ?? 0, cursor?.id ?? '', cursor?.source ?? '', ctx.botId), value => value[0]);
    const rows = result.filter(row => row.reservation_id).map(({ schema_version, format, init_state, ...row }) => row);
    const items = rows.slice(0, 15);
    const last = items.at(-1);

    return {
        items,
        ...(rows.length > 15 && last ? { nextCursor: encodeURIComponent(JSON.stringify({ bot: ctx.botId, time: last.expires_at_ms, id: last.reservation_id, source: last.source })) } : {})
    };
}

export async function reservationLookup(ctx: PluginContext, source: string, id: string) {
    identifier(source);
    identifier(id);

    const row = await readReady(ctx, () => ctx.db.first<FundRow & {
        schema_version: number; format: string; init_state: string; observed_at_ms: number;
    }>(`SELECT m.schema_version,m.format,m.init_state,r.*,${DATABASE_NOW_MS} AS observed_at_ms
        FROM {wallet_state} m LEFT JOIN {reservations} r ON r.bot_id=m.bot_id AND r.source=? AND r.reservation_id=?
        WHERE m.bot_id=?`, source, id, ctx.botId), value => value);

    if (!row?.reservation_id) { return null; }

    const { schema_version, format, init_state, ...reservation } = row;

    return reservation;
}
