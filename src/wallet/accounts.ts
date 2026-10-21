import type { PluginContext } from '@qqbot/sdk';
import type { AccountRow } from './model.js';
import { requireCondition } from './errors.js';
import { balance } from './model.js';
import { identifier } from './ledger/operations.js';
import { readReady, WALLET_READY } from './storage/schema.js';
import { statement } from './storage/sql.js';
import { DATABASE_NOW_MS } from './time.js';

export async function ownBalance(ctx: PluginContext, user: string) {
    identifier(user);
    const existing = await readAccount(ctx, user);

    if (existing) {
        return balance(existing);
    }

    requireCondition(false, 'ACCOUNT_NOT_FOUND');
}

// 仅供插件内部命令使用，不通过 points.wallet 暴露。
export async function openOwnAccount(ctx: PluginContext, user: string) {
    identifier(user);
    const existing = await readAccount(ctx, user);

    if (existing) { return balance(existing); }

    const result = await ctx.db.batch([
        statement(`INSERT INTO {accounts}(bot_id,user_id,created_at_ms,updated_at_ms)
            SELECT ?,?,${DATABASE_NOW_MS},${DATABASE_NOW_MS} FROM {wallet_state} WHERE bot_id=? AND ${WALLET_READY}
            ON CONFLICT(bot_id,user_id) DO NOTHING`, ctx.botId, user, ctx.botId),
        statement('UPDATE {wallet_state} SET ledger_revision=ledger_revision+1 WHERE bot_id=? AND changes()=1', ctx.botId),
        statement('SELECT * FROM {accounts} WHERE bot_id=? AND user_id=?', ctx.botId, user)
    ]);
    const row = result[2]!.results[0] as unknown as AccountRow | undefined;

    if (!row) {
        throw new Error('Wallet is not ready');
    }

    return balance(row);
}

export async function readAccount(ctx: PluginContext, user: string): Promise<AccountRow | null> {
    const row = await readReady(ctx, () => ctx.db.first<AccountRow & { schema_version: number; format: string; init_state: string }>(`SELECT m.schema_version,m.format,m.init_state,a.*
        FROM {wallet_state} m LEFT JOIN {accounts} a ON a.bot_id=m.bot_id AND a.user_id=? WHERE m.bot_id=?`, user, ctx.botId), value => value);

    if (!row?.user_id) { return null; }

    const { schema_version, format, init_state, ...account } = row;

    return account;
}
