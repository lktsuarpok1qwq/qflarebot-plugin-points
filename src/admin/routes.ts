import { requireLedger } from '../wallet/ledger/ledger.js';
import type { PluginContext, Route } from '@qqbot/sdk';
import { ensureSchemaReady, readReady } from '../wallet/storage/schema.js';
import { boundedContext } from '../wallet/storage/runtime.js';
import { requireCondition } from '../wallet/errors.js';
import { identifier, lookup, readReadyOperation } from '../wallet/ledger/operations.js';
import { mutate } from '../wallet/mutations.js';
import { readAccount } from '../wallet/accounts.js';
import { administrativeAction } from './actions.js';
import { setSourcePolicy, setWalletPolicy } from '../wallet/policies.js';
import type { WalletPolicy } from '../wallet/policies.js';
import { historyPage } from '../wallet/history.js';
import { pick } from '../wallet/input.js';
import { LIMITS } from '../wallet/limits.js';
import { expiryStep } from '../wallet/maintenance.js';
import { PAGE_HTML } from '../ui/page.js';
import { reservationLookup, reservationWorklist } from '../wallet/reservation-queries.js';
import { recentAdminOperations } from './operations.js';
import { loadReplySettings, saveReplySettings } from '../messages/reply-settings.js';
import { findQqBinding, changeQqBinding, bindingFailure } from './qq-bindings.js';

async function readBody(request: Request): Promise<Record<string, unknown>> {
    requireCondition(request.body, 'INVALID_ARGUMENT');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
        while (true) {
            const part = await reader.read();

            if (part.done) {
                break;
            }

            total += part.value.byteLength;
            requireCondition(total <= LIMITS.requestBytes, 'LIMIT_EXCEEDED');
            chunks.push(part.value);
        }
    } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }

    const bytes = new Uint8Array(total);
    let position = 0;

    for (const chunk of chunks) {
        bytes.set(chunk, position);
        position += chunk.length;
    }

    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
    requireCondition(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_ARGUMENT');

    return value as Record<string, unknown>;
}

async function state(ctx: PluginContext, query: URLSearchParams) {
    const kind = query.get('kind') ?? 'policy';
    const user = query.get('user') ?? '';
    const source = query.get('source') ?? '';
    const after = query.get('after') ?? '';

    if (user) {
        identifier(user);
    }

    if (source) {
        identifier(source);
    }

    requireCondition(after.length <= 128, 'INVALID_ARGUMENT');

    switch (kind) {
        case 'qq-binding': {
            requireCondition([...query.keys()].every(key => ['kind', 'qq'].includes(key)), 'INVALID_ARGUMENT');

            return findQqBinding(ctx, query.get('qq'));
        }
        case 'reply-templates': {
            requireCondition([...query.keys()].every(key => key === 'kind'), 'INVALID_ARGUMENT');

            return loadReplySettings(ctx);
        }
        case 'policy': {
            const row = await readReady(ctx, () => ctx.db.first<WalletPolicy & { schema_version: number; format: string; init_state: string }>(`SELECT
                schema_version,format,init_state,bot_id,qq_transfer_enabled,qq_fee_mode,qq_fee_numerator,qq_fee_denominator,policy_version
                FROM {wallet_state} WHERE bot_id=?`, ctx.botId), value => value);
            const { schema_version, format, init_state, ...policy } = row!;

            return policy;
        }
        case 'account': return readAccount(ctx, user);
        case 'transaction': {
            const id = identifier(query.get('id'));
            const row = await readReady(ctx, () => ctx.db.first<{
                ledger_json: string;
            } & Record<string, unknown>>(`SELECT m.schema_version,m.format,m.init_state,i.*,r.tx_id AS reversal_tx_id
                FROM {wallet_state} m LEFT JOIN {transactions} i ON i.bot_id=m.bot_id AND i.tx_id=?
                LEFT JOIN {transactions} r ON r.reverses_tx_id=i.tx_id AND r.bot_id=i.bot_id
                WHERE m.bot_id=?`, id, ctx.botId), value => value);
            requireCondition(row?.tx_id, 'TRANSACTION_NOT_FOUND');
            const { schema_version, format, init_state, ...transaction } = row!;

            return { ...transaction, ledger: requireLedger(transaction.ledger_json, transaction.expected_entry_count as number) };
        }
        case 'operation': {
            const row = await readReadyOperation(ctx, identifier(source), identifier(query.get('id')));

            return { ...lookup(row), reason: row?.reason ?? null };
        }
        case 'admin-operations': {
            requireCondition([...query.keys()].every(key => ['kind', 'cursor'].includes(key)), 'INVALID_ARGUMENT');

            return recentAdminOperations(ctx, query.has('cursor') ? query.get('cursor')! : undefined);
        }
        case 'sources': {
            // 空列表仍保留钱包标记，校验后移除元数据及空连接行。
            const rows = await readReady(ctx, () => ctx.db.all<Record<string, unknown>>(`SELECT m.schema_version,m.format,m.init_state,r.*
                FROM {wallet_state} m LEFT JOIN {sources} r ON r.bot_id=m.bot_id AND r.source>?
                WHERE m.bot_id=? ORDER BY r.source LIMIT 50`, after, ctx.botId), value => value[0]);

            return rows.filter(row => row.source).map(({ schema_version, format, init_state, ...row }) => row);
        }
        case 'funds': {
            requireCondition([...query.keys()].every(key => ['kind', 'cursor'].includes(key)), 'INVALID_ARGUMENT');

            return reservationWorklist(ctx, query.get('cursor') ?? undefined);
        }
        case 'fund': {
            requireCondition([...query.keys()].every(key => ['kind', 'source', 'id'].includes(key)), 'INVALID_ARGUMENT');

            return reservationLookup(ctx, source, identifier(query.get('id')));
        }
        case 'history': return historyPage(ctx, { month: query.get('month') ?? '', user, source, cursor: query.get('cursor') ?? undefined });
        case 'history-export': {
            requireCondition([...query.keys()].every(key => ['kind', 'month', 'cursor'].includes(key)), 'INVALID_ARGUMENT');
            const page = await historyPage(ctx, { month: query.get('month') ?? '', cursor: query.get('cursor') ?? undefined }, 50);

            return { ...page, botId: ctx.botId, format: 'points.monthly-ledger/v1' };
        }
        default: requireCondition(false, 'INVALID_ARGUMENT');
    }
}

async function action(ctx: PluginContext, body: Record<string, unknown>) {
    const { action: name, confirmed, ...input } = body;
    requireCondition(typeof name === 'string', 'INVALID_ARGUMENT');

    if (name === 'qq-bind' || name === 'qq-unbind') {
        requireCondition(confirmed === true, 'INVALID_ARGUMENT');

        return changeQqBinding(ctx, name, input);
    }

    if (name === 'reply-templates') {
        pick(body, ['action', 'expectedRevision', 'replies', 'buttons']);

        return saveReplySettings(ctx, input);
    }

    if (name === 'expire') {
        pick(input, []);
        await expiryStep(ctx);

        return { ok: true };
    }

    requireCondition(confirmed === true && typeof input.reason === 'string' && input.reason.trim().length > 0, 'INVALID_ARGUMENT');
    identifier(input.operationId);

    if (name === 'source-policy') {
        return setSourcePolicy(ctx, input as unknown as Parameters<typeof setSourcePolicy>[1]);
    }

    if (name === 'wallet-policy') {
        return setWalletPolicy(ctx, input as unknown as Parameters<typeof setWalletPolicy>[1]);
    }

    if (name === 'status' || name === 'compensate' || name === 'release') {
        return administrativeAction(ctx, name, input);
    }

    requireCondition(['credit', 'burn', 'reverseOwn'].includes(name), 'INVALID_ARGUMENT');

    return mutate(ctx, name as 'credit' | 'burn' | 'reverseOwn', { ...input, source: 'admin' }, true);
}

export const adminRoutes: Route[] = [
    {
        method: 'GET', path: '/ui/*', auth: 'admin', handler: async () => new Response(PAGE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
    },
    {
        method: 'GET', path: '/api/state', auth: 'admin', handler: async ({ ctx: original, request, authenticated }) => {
            if (!authenticated) {
                return new Response('Unauthorized', { status: 401 });
            }

            const ctx = boundedContext(original);

            try {
                const query = new URL(request.url).searchParams;

                if (!['history', 'history-export', 'reply-templates', 'qq-binding', 'account', 'operation', 'policy', 'transaction', 'fund', 'sources', 'funds', 'admin-operations'].includes(query.get('kind') ?? 'policy')) {
                    await ensureSchemaReady(ctx);
                }

                return Response.json({ ok: true, data: await state(ctx, query) }, { headers: { 'cache-control': 'no-store' } });
            } catch (error) {
                return Response.json(bindingFailure(error), { status: 400 });
            }
        }
    },
    {
        method: 'POST', path: '/api/action', auth: 'admin', handler: async ({ ctx, request, authenticated }) => {
            if (!authenticated) {
                return new Response('Unauthorized', { status: 401 });
            }

            try {
                return Response.json(await action(boundedContext(ctx), await readBody(request)), { headers: { 'cache-control': 'no-store' } });
            } catch (error) {
                return Response.json(bindingFailure(error), { status: 400 });
            }
        }
    }
];
