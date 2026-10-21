import type { PluginContext } from '@qqbot/sdk';
import { identifier } from '../wallet/ledger/operations.js';
import { pick } from '../wallet/input.js';
import { requireCondition, systemFailure } from '../wallet/errors.js';
import { readReady, WALLET_READY } from '../wallet/storage/schema.js';
import { statement } from '../wallet/storage/sql.js';

export interface QqBinding { qqNumber: string; userId: string; }
export class QqBindingError extends Error {
    constructor(readonly code: string, message: string, readonly retryable = false) { super(message); }
}

export function qqNumber(value: unknown): string {
    identifier(value);

    if (!/^[1-9][0-9]*$/.test(value as string)) { throw new QqBindingError('INVALID_QQ_NUMBER', 'QQ 号应为非零开头的纯数字'); }

    return value as string;
}

export function bindingFailure(error: unknown) {
    return error instanceof QqBindingError
        ? { ok: false as const, code: error.code, message: error.message, retryable: error.retryable }
        : systemFailure(error);
}

function missingTable(error: unknown) {
    return error instanceof Error && /no such table: (?:\w+\.)?p_points_qq_bindings\b/.test(error.message);
}

export async function findQqBinding(ctx: Pick<PluginContext, 'db' | 'botId'>, value: unknown): Promise<QqBinding | null> {
    const qq = qqNumber(value);

    try {
        return await ctx.db.first<QqBinding>('SELECT qq_number AS qqNumber,user_id AS userId FROM {qq_bindings} WHERE bot_id=? AND qq_number=?', ctx.botId, qq);
    } catch (error) {
        if (missingTable(error)) { return null; }

        throw new QqBindingError('INTERNAL_ERROR', '绑定暂不可用，请重新查询 QQ 号', true);
    }
}

async function pairBindings(ctx: PluginContext, qq: string, user: string) {
    const read = () => ctx.db.all<QqBinding>(`SELECT qq_number AS qqNumber,user_id AS userId FROM {qq_bindings} WHERE bot_id=? AND qq_number=?
        UNION ALL SELECT qq_number AS qqNumber,user_id AS userId FROM {qq_bindings} WHERE bot_id=? AND user_id=? AND qq_number<>?`, ctx.botId, qq, ctx.botId, user, qq);

    try { return await read(); } catch (error) {
        if (!missingTable(error)) { throw error; }

        // 独立管理员映射表，仅首次绑定创建；不改资金格式、账户或模板。
        await ctx.db.batch([statement(`CREATE TABLE IF NOT EXISTS {qq_bindings} (
            bot_id TEXT NOT NULL,qq_number TEXT NOT NULL CHECK(length(qq_number) BETWEEN 1 AND 128
                AND qq_number NOT GLOB '*[^0-9]*' AND substr(qq_number,1,1) BETWEEN '1' AND '9'),
            user_id TEXT NOT NULL,PRIMARY KEY(bot_id,qq_number),UNIQUE(bot_id,user_id)) WITHOUT ROWID`)]);

        return read();
    }
}

export async function changeQqBinding(ctx: PluginContext, action: 'qq-bind' | 'qq-unbind', input: unknown) {
    try {
        const value = pick(input, ['qqNumber', 'userId']);
        const qq = qqNumber(value.qqNumber), user = identifier(value.userId);

        if (action === 'qq-unbind') {
            const current = await findQqBinding(ctx, qq);

            if (!current) { return { ok: true as const, data: { qqNumber: qq, userId: user, bound: false } }; }

            if (current.userId !== user) { throw new QqBindingError('QQ_BINDING_CHANGED', '绑定已变化，请重新查询后操作'); }

            const result = await ctx.db.batch([statement(`DELETE FROM {qq_bindings}
                WHERE bot_id=? AND qq_number=? AND user_id=?`, ctx.botId, qq, user)]);

            if (result[0]!.changes === 0 && await findQqBinding(ctx, qq)) {
                throw new QqBindingError('QQ_BINDING_CHANGED', '绑定已变化，请重新查询后操作');
            }

            return { ok: true as const, data: { qqNumber: qq, userId: user, bound: false } };
        }

        // 同次读取校验本机器人钱包与开户状态，不读取余额；空连接仍保留格式标记。
        const account = await readReady(ctx, () => ctx.db.first<{ user_id: string | null }>(`SELECT m.schema_version,m.format,m.init_state,a.user_id
            FROM {wallet_state} m LEFT JOIN {accounts} a ON a.bot_id=m.bot_id AND a.user_id=?
            WHERE m.bot_id=?`, user, ctx.botId), value => value);
        requireCondition(account?.user_id, 'ACCOUNT_NOT_FOUND');
        const rows = await pairBindings(ctx, qq, user);
        const same = (row: QqBinding) => row.qqNumber === qq && row.userId === user;

        if (rows.some(row => !same(row))) { throw new QqBindingError('QQ_BINDING_CONFLICT', 'QQ 号或 SID 已有其他绑定，请先解绑'); }

        if (rows.length) { return { ok: true as const, data: { qqNumber: qq, userId: user, bound: true } }; }

        const result = await ctx.db.batch([statement(`INSERT INTO {qq_bindings}(bot_id,qq_number,user_id)
            SELECT ?,?,a.user_id FROM {accounts} a JOIN {wallet_state} m ON m.bot_id=a.bot_id
            WHERE a.bot_id=? AND a.user_id=? AND ${WALLET_READY} ON CONFLICT DO NOTHING`, ctx.botId, qq, ctx.botId, user)]);

        if (result[0]!.changes === 0) {
            const winner = await pairBindings(ctx, qq, user);

            if (winner.some(row => !same(row))) { throw new QqBindingError('QQ_BINDING_CONFLICT', 'QQ 号或 SID 已有其他绑定，请先解绑'); }

            requireCondition(winner.length === 1 && same(winner[0]!), 'INTERNAL_ERROR');
        }

        return { ok: true as const, data: { qqNumber: qq, userId: user, bound: true } };
    } catch (error) {
        const failure = bindingFailure(error);

        return failure.retryable ? { ...failure, message: '绑定操作结果尚未确认，请查询对应 QQ 号或原样重试' } : failure;
    }
}
