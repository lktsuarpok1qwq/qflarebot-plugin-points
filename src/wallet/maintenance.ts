import type { PluginContext } from '@qqbot/sdk';
import { readReady } from './storage/schema.js';
import { requestHash } from './ledger/operations.js';
import { DATABASE_NOW_MS } from './time.js';
import { emptySnapshot } from './ledger/snapshot.js';
import { LedgerPlan } from './ledger/plan.js';
import { releaseFund } from './reservations.js';
import { commit } from './ledger/commit.js';
import type { AccountRow, FundRow } from './model.js';
import type { Input } from './input.js';

// 每次调用只执行一笔有上限的事务，不提供公开批量释放接口或持久队列。
export const EXPIRY_BATCH_SIZE = 15;

export async function expiryStep(ctx: PluginContext): Promise<void> {
    // LEFT JOIN 在没有候选项时仍保留修订号和时间，空闲时只查询一次。
    const rows = await readReady(ctx, () => ctx.db.all<FundRow & {
        schema_version: number;
        format: string;
        init_state: string;
        ledger_revision: number;
        now: number;
    }>(`
        SELECT m.schema_version,m.format,m.init_state,m.ledger_revision,${DATABASE_NOW_MS} AS now,r.* FROM {wallet_state} m
        LEFT JOIN {reservations} r ON r.bot_id=m.bot_id AND r.status='active' AND r.expires_at_ms<=${DATABASE_NOW_MS}
        WHERE m.bot_id=? ORDER BY r.expires_at_ms,r.reservation_id,r.source LIMIT ?`, ctx.botId, EXPIRY_BATCH_SIZE), result => result[0], true);
    const first = rows[0];

    if (!first || !first.reservation_id) {
        return;
    }

    const snapshot = emptySnapshot(ctx.botId, { ledger_revision: first.ledger_revision, now: first.now });
    // 复用预留写入逻辑前移除查询元数据。
    snapshot.funds = rows.map(({ schema_version, format, init_state, ledger_revision, now, ...row }) => row);
    const userIds = [...new Set(snapshot.funds.map(row => row.user_id))];
    // 去重后逐个按完整主键读取，避免 IN 的中间读行；缺失账户仍由账务计划拒绝。
    const owners = await ctx.db.first<{ owners_json: string }>(`SELECT json_array(${userIds.map(() => `json((SELECT json_object(
        'bot_id',bot_id,'user_id',user_id,'available_minor',available_minor,'reserved_minor',reserved_minor,
        'status',status,'version',version,'created_at_ms',created_at_ms,'updated_at_ms',updated_at_ms)
        FROM {accounts} WHERE bot_id=? AND user_id=?))`).join(',')}) AS owners_json`, ...userIds.flatMap(userId => [ctx.botId, userId]));
    snapshot.accounts = (JSON.parse(owners!.owners_json) as (AccountRow | null)[]).filter((row): row is AccountRow => row !== null);

    const selection = snapshot.funds.map(row => [row.source, row.reservation_id, row.expires_at_ms, row.last_operation_source, row.last_operation_id]);
    const hash = await requestHash('system.expire', { bot: ctx.botId, revision: snapshot.revision, funds: selection });
    const input: Input = { source: 'points.system', operationId: `expire-${hash}`, reason: '预留到期释放' };
    const plan = new LedgerPlan(snapshot, input);
    // 时钟回退允许重试，不持久化拒绝结果，
    // 避免同一批本金再次到期后无法复用稳定批次编号。
    plan.data.notBeforeMs = Math.max(...snapshot.funds.map(row => row.expires_at_ms));

    for (const fund of snapshot.funds) {
        const row = { ...fund };
        plan.data.funds.push(row);
        plan.active(row, false);
        // 系统维护退回到期本金，不受来源当前权限影响。
        releaseFund(plan, row);
    }

    plan.finish();
    // 共用提交守卫检查修订号和操作唯一性；并发选中同一批本金时使用相同编号，
    // 丢失响应不会使终态记录重新进入候选集合。
    const result = await commit(ctx, input, hash, plan);

    if (!result.ok) {
        throw new Error(result.code);
    }
}
