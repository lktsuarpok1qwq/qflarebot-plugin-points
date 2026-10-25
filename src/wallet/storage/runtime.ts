import type { PluginContext, PluginDB } from '@qqbot/sdk';
import { PointsFault } from '../errors.js';

// ContextFactory 为每个请求创建独立的 DB 包装；此处仅跟踪查询消耗，
// 不在内存中保存资金状态、幂等结果或锁。
const budgets = new WeakMap<PluginDB, {
    used: number;
    db: PluginDB;
    readiness: Map<string, Promise<boolean>>;
}>();
export const POINTS_QUERY_BUDGET = 40;

export function boundedContext(ctx: PluginContext): PluginContext {
    const previous = budgets.get(ctx.db);

    if (previous) {
        return { ...ctx, db: previous.db };
    }

    const source = ctx.db;
    const state = { used: 0, db: source, readiness: new Map<string, Promise<boolean>>() };
    const take = (count: number) => {
        if (state.used + count > POINTS_QUERY_BUDGET) {
            throw new PointsFault('BUSY', true);
        }

        state.used += count;
    };
    const db: PluginDB = {
        table: name => source.table(name),
        async exec() {
            throw new Error('Use counted DDL batch statements');
        },
        async run(sql, ...params) {
            take(1);

            return source.run(sql, ...params);
        },
        async all<T>(sql: string, ...params: unknown[]) {
            take(1);

            return source.all<T>(sql, ...params);
        },
        async first<T>(sql: string, ...params: unknown[]) {
            take(1);

            return source.first<T>(sql, ...params);
        },
        async batch<T>(statements: Parameters<PluginDB['batch']>[0]) {
            take(statements.length);

            return source.batch<T>(statements);
        }
    };
    state.db = db;
    budgets.set(source, state);
    budgets.set(db, state);

    return { ...ctx, db };
}

// 仅对 SDK 请求级计数上下文生效，不缓存资金或政策。
export function requestReadiness(db: PluginDB, bot: string, initialize: () => Promise<boolean>): Promise<boolean> {
    const state = budgets.get(db);

    if (!state) {
        return initialize();
    }

    let pending = state.readiness.get(bot);

    if (!pending) {
        pending = initialize().catch(error => {
            state.readiness.delete(bot);
            throw error;
        });
        state.readiness.set(bot, pending);
    }

    return pending;
}

// 同一计数请求中已创建资金库时仍须推迟业务，不因联合查询已能读到钱包而放行。
export async function deferInitializedBusiness(db: PluginDB, bot: string): Promise<void> {
    const pending = budgets.get(db)?.readiness.get(bot);

    if (pending && await pending) { throw new PointsFault('BUSY', true); }
}
