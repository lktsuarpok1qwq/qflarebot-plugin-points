import type { PluginContext } from '@qqbot/sdk';
import { requireCondition } from './errors.js';
import { identifier } from './ledger/operations.js';
import { statement } from './storage/sql.js';
import { readLedger } from './ledger/ledger.js';
import { readReady } from './storage/schema.js';

interface HistoryCursor {
    bot: string;
    month: string;
    user: string;
    source: string;
    revision: number;
    time: number;
    tx: string;
}

const HISTORY_COLUMNS = `i.tx_id,i.bot_id,i.source,i.operation_id,i.type,i.reference_id,i.reverses_tx_id,i.compensates_tx_id,
    i.created_at_ms,i.date_bjt,i.month_bjt,i.commit_revision,i.reason,i.expected_entry_count,i.ledger_json`;

async function personalSourceRows(ctx: PluginContext, scope: {
    user: string;
    source: string;
    month: string;
    revision: number;
    cursor: HistoryCursor | null;
}, prefix: Record<string, unknown>[], limit: number): Promise<Record<string, unknown>[]> {
    const selected = prefix.filter(row => row.source === scope.source);

    if (prefix.length < limit || selected.length === limit) {
        return selected;
    }

    // 先限制来源候选数量，再按完整用户主键判断归属；不能先过滤用户再 LIMIT，
    // 否则稀疏账户仍会扫描整个来源。高水位沿用首次读取，不接纳期间的新交易。
    const sourceRows = await ctx.db.all<Record<string, unknown>>(`SELECT ${HISTORY_COLUMNS},
        EXISTS(SELECT 1 FROM {transaction_accounts} a WHERE a.bot_id=i.bot_id AND a.user_id=?
            AND a.month_bjt=i.month_bjt AND a.created_at_ms=i.created_at_ms AND a.tx_id=i.tx_id
            AND a.commit_revision<=?) AS user_matches
        FROM {transactions} i WHERE i.bot_id=? AND i.source=? AND i.month_bjt=?
        AND (i.created_at_ms,i.tx_id)<(?,?) ORDER BY i.created_at_ms DESC,i.tx_id DESC LIMIT ?`,
        scope.user, scope.revision, ctx.botId, scope.source, scope.month,
        scope.cursor?.time ?? Number.MAX_SAFE_INTEGER, scope.cursor?.tx ?? '', limit);
    const matching = sourceRows.filter(row => row.user_matches === 1).map(({ user_matches, ...row }) => row);

    if (sourceRows.length < limit || matching.length === limit) {
        return matching;
    }

    // 两边均未读尽时，从个人候选的末尾继续，避免重复扫描已读取的那一段。
    const last = prefix.at(-1)!;
    const remaining = await ctx.db.all<Record<string, unknown>>(`SELECT ${HISTORY_COLUMNS}
        FROM {transaction_accounts} a CROSS JOIN {transactions} i ON i.tx_id=a.tx_id
        WHERE a.bot_id=? AND a.user_id=? AND a.month_bjt=? AND i.source=? AND a.commit_revision<=?
        AND (a.created_at_ms,a.tx_id)<(?,?) ORDER BY a.created_at_ms DESC,a.tx_id DESC LIMIT ?`,
        ctx.botId, scope.user, scope.month, scope.source, scope.revision, last.created_at_ms, last.tx_id, limit - selected.length);

    return [...selected, ...remaining];
}

export async function historyPage(ctx: PluginContext, input: {
    month: string;
    user?: string;
    source?: string;
    cursor?: string;
}, pageSize: 8 | 50 = 8) {
    requireCondition(/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month), 'INVALID_ARGUMENT');
    const user = input.user ?? '';
    const source = input.source ?? '';

    if (user) {
        identifier(user);
    }

    if (source) {
        identifier(source);
    }

    let cursor: HistoryCursor | null = null;

    if (input.cursor) {
        requireCondition(input.cursor.length <= 2048, 'INVALID_ARGUMENT');
        cursor = JSON.parse(decodeURIComponent(input.cursor)) as HistoryCursor;
        requireCondition(cursor && cursor.bot === ctx.botId && cursor.month === input.month && cursor.user === user
            && cursor.source === source && Number.isSafeInteger(cursor.revision) && cursor.revision >= 0
            && Number.isSafeInteger(cursor.time) && cursor.time >= 0, 'INVALID_ARGUMENT');
        identifier(cursor.tx);
    }

    const from = user ? `{transaction_accounts} a CROSS JOIN {transactions} i ON i.tx_id=a.tx_id` : '{transactions} i';
    const scope = user ? 'a.bot_id=? AND a.user_id=? AND a.month_bjt=?' : 'i.bot_id=? AND i.month_bjt=?';
    const ordered = user ? 'a' : 'i';
    const params = user ? [ctx.botId, user, input.month] : [ctx.botId, input.month];
    const readSource = user ? '' : source;

    if (readSource) {
        params.push(readSource);
    }

    const result = await readReady(ctx, () => ctx.db.batch([
        statement('SELECT schema_version,format,init_state,ledger_revision FROM {wallet_state} WHERE bot_id=?', ctx.botId),
        statement(`SELECT ${HISTORY_COLUMNS} FROM ${from} WHERE ${scope} ${readSource ? 'AND i.source=?' : ''}
            AND ${ordered}.commit_revision<=COALESCE(?,(SELECT ledger_revision FROM {wallet_state} WHERE bot_id=?))
            AND (${ordered}.created_at_ms,${ordered}.tx_id)<(?,?)
            ORDER BY ${ordered}.created_at_ms DESC,${ordered}.tx_id DESC LIMIT ?`, ...params, cursor?.revision ?? null, ctx.botId, cursor?.time ?? Number.MAX_SAFE_INTEGER, cursor?.tx ?? '', pageSize + 1)
    ]), value => value[0]!.results[0]);
    const revision = cursor?.revision ?? result[0]!.results[0]!.ledger_revision as number;
    const candidates = user && source ? await personalSourceRows(ctx, {
        user, source, month: input.month, revision, cursor
    }, result[1]!.results, pageSize + 1) : result[1]!.results;
    const rows = candidates.slice(0, pageSize);
    const items: Record<string, unknown>[] = rows.map(({ ledger_json, ...row }) => {
        const ledger = readLedger(ledger_json as string, row.expected_entry_count as number);

        return {
            ...row, minted: ledger?.minted ?? null, burned: ledger?.burned ?? null,
            transferred: ledger?.transferred ?? null, reversalMint: ledger?.reversalMint ?? null,
            reversalBurn: ledger?.reversalBurn ?? null,
            entries: ledger?.entries.map(entry => ({
                tx_id: row.tx_id, entry_no: entry.entryNo, account_id: entry.accountId,
                bucket: entry.bucket, delta_minor: entry.deltaMinor, reservation_id: entry.reservationId ?? null
            })) ?? [],
            bodyStatus: ledger ? 'loaded' : 'unavailable'
        };
    });
    const pageTotals = Object.fromEntries(['minted', 'burned', 'reversalMint', 'reversalBurn', 'transferred'].map(key => [key, items.reduce((sum, row) => sum + BigInt((row[key] ?? 0) as number), 0n).toString()]));
    const last = rows.at(-1);

    return {
        month: input.month, items, pageTotals, highWaterRevision: revision, bodyComplete: items.every(item => item.bodyStatus === 'loaded'),
        ...(candidates.length > pageSize && last ? {
            nextCursor: encodeURIComponent(JSON.stringify({
                bot: ctx.botId, month: input.month, user, source, revision, time: last.created_at_ms, tx: last.tx_id
            }))
        } : {})
    };
}
