import type { PluginContext } from '@qqbot/sdk';
import { requireCondition } from '../wallet/errors.js';
import { identifier } from '../wallet/ledger/operations.js';
import { readReady } from '../wallet/storage/schema.js';

interface OperationCursor {
    bot: string;
    time: number;
    id: string;
}
interface AdminOperation {
    operation_id: string;
    created_at_ms: number;
    status: 'committed' | 'rejected';
    reason: string | null;
    result_code: string | null;
    transaction_id: string | null;
}

// 只读取已有的不可变回执，不保存变更快照或增加审计写入。
export async function recentAdminOperations(ctx: PluginContext, encodedCursor?: string) {
    let cursor: OperationCursor | undefined;

    if (encodedCursor !== undefined) {
        requireCondition(encodedCursor.length <= 2048, 'INVALID_ARGUMENT');

        try {
            cursor = JSON.parse(decodeURIComponent(encodedCursor));
        } catch {
            requireCondition(false, 'INVALID_ARGUMENT');
        }

        requireCondition(cursor && Object.keys(cursor).every(key => ['bot', 'time', 'id'].includes(key))
            && cursor.bot === ctx.botId && Number.isSafeInteger(cursor.time) && cursor.time >= 0, 'INVALID_ARGUMENT');
        identifier(cursor.id);
    }

    const result = await readReady(ctx, () => ctx.db.all<AdminOperation & {
        schema_version: number; format: string; init_state: string;
    }>(`SELECT m.schema_version,m.format,m.init_state,r.operation_id,r.created_at_ms,r.status,r.reason,r.result_code,r.transaction_id
        FROM {wallet_state} m LEFT JOIN {operations} r ON r.bot_id=m.bot_id AND r.source='admin'
        ${cursor ? 'AND (r.created_at_ms,r.operation_id)<(?,?)' : ''}
        WHERE m.bot_id=? ORDER BY r.created_at_ms DESC,r.operation_id DESC LIMIT 16`,
        ...(cursor ? [cursor.time, cursor.id] : []), ctx.botId), value => value[0]);
    const rows = result.filter(row => row.operation_id).map(({ schema_version, format, init_state, ...row }) => row);
    const items = rows.slice(0, 15);
    const last = items.at(-1);

    return {
        items,
        ...(rows.length > 15 && last ? { nextCursor: encodeURIComponent(JSON.stringify({ bot: ctx.botId, time: last.created_at_ms, id: last.operation_id })) } : {})
    };
}
