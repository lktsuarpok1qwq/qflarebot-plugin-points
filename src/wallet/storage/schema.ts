import type { PluginContext, PluginDB } from '@qqbot/sdk';
import { PointsFault } from '../errors.js';
import { DATABASE_NOW_MS } from '../time.js';
import { statement } from './sql.js';
import { deferInitializedBusiness, requestReadiness } from './runtime.js';

export const SCHEMA_VERSION = 1;
export const SCHEMA_FORMAT = 'points.wallet/V1-stable-intents';
export const INTERNAL_SOURCES = ['admin', 'points.qq', 'points.system'] as const;
const SAFE = '9007199254740991';
const money = (name: string) => `${name} INTEGER NOT NULL DEFAULT 0 CHECK(typeof(${name})='integer' AND ${name} BETWEEN 0 AND ${SAFE})`;
const signedMoney = (name: string) => `${name} INTEGER NOT NULL CHECK(typeof(${name})='integer' AND ${name} BETWEEN -${SAFE} AND ${SAFE})`;
const version = (name: string) => `${name} INTEGER NOT NULL DEFAULT 0 CHECK(typeof(${name})='integer' AND ${name} BETWEEN 0 AND ${SAFE})`;
const reservationColumns = `bot_id TEXT NOT NULL, source TEXT NOT NULL, reference_id TEXT NOT NULL,
    ${money('amount_minor')}, status TEXT NOT NULL CHECK(status IN ('active','released','consumed','expired')),
    created_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL, renewed_at_ms INTEGER,
    renewal_deadline_ms INTEGER NOT NULL, policy_version INTEGER NOT NULL, recovery_permissions TEXT NOT NULL,
    created_operation_id TEXT NOT NULL, last_operation_id TEXT NOT NULL, last_operation_source TEXT NOT NULL,
    terminal_operation_id TEXT, terminal_operation_source TEXT, consumed_tx_id TEXT,
    CHECK(amount_minor > 0), CHECK(expires_at_ms > created_at_ms), CHECK(renewal_deadline_ms >= expires_at_ms),
    CHECK((status='active' AND terminal_operation_id IS NULL AND terminal_operation_source IS NULL)
        OR (status!='active' AND terminal_operation_id IS NOT NULL AND terminal_operation_source IS NOT NULL))`;
// 全部 DDL 在同一批次内执行，首次安装失败不留下部分表结构。
// 不使用 IF NOT EXISTS，避免静默接管已有的无标记对象。
export const SCHEMA_DDL = [
    `CREATE TABLE {accounts} (bot_id TEXT NOT NULL, user_id TEXT NOT NULL,
        ${money('available_minor')}, ${money('reserved_minor')},
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')), ${version('version')},
        created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
        CHECK(available_minor <= ${SAFE} - reserved_minor), PRIMARY KEY(bot_id,user_id)) WITHOUT ROWID`,
    `CREATE TABLE {operations} (bot_id TEXT NOT NULL, source TEXT NOT NULL, operation_id TEXT NOT NULL,
        request_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('committed','rejected')),
        result_code TEXT, result_json TEXT NOT NULL CHECK(json_valid(result_json)), transaction_id TEXT, reason TEXT,
        created_at_ms INTEGER NOT NULL, PRIMARY KEY(bot_id,source,operation_id)) WITHOUT ROWID`,
    `CREATE INDEX {admin_operations_recent} ON {operations}(bot_id,created_at_ms,operation_id) WHERE source='admin'`,
    `CREATE TABLE {transactions} (tx_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, source TEXT NOT NULL,
        operation_id TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('mint','burn','transfer','reserve','release','settle','reverse','compensate')),
        reference_id TEXT, reverses_tx_id TEXT, compensates_tx_id TEXT, created_at_ms INTEGER NOT NULL,
        date_bjt TEXT NOT NULL, month_bjt TEXT NOT NULL, commit_revision INTEGER NOT NULL,
        ledger_json TEXT NOT NULL CHECK(json_valid(ledger_json)), reason TEXT,
        expected_entry_count INTEGER NOT NULL CHECK(typeof(expected_entry_count)='integer' AND expected_entry_count BETWEEN 1 AND 96)) WITHOUT ROWID`,
    `CREATE UNIQUE INDEX {transaction_reversal} ON {transactions}(reverses_tx_id) WHERE reverses_tx_id IS NOT NULL`,
    `CREATE INDEX {transactions_month} ON {transactions}(bot_id,month_bjt,created_at_ms,tx_id)`,
    `CREATE INDEX {transactions_source} ON {transactions}(bot_id,source,month_bjt,created_at_ms,tx_id)`,
    `CREATE TABLE {transaction_accounts} (tx_id TEXT NOT NULL, bot_id TEXT NOT NULL, user_id TEXT NOT NULL,
        month_bjt TEXT NOT NULL, created_at_ms INTEGER NOT NULL, commit_revision INTEGER NOT NULL,
        ${signedMoney('available_delta_minor')}, ${signedMoney('reserved_delta_minor')},
        PRIMARY KEY(bot_id,user_id,month_bjt,created_at_ms,tx_id)) WITHOUT ROWID`,
    `CREATE TABLE {reservations} (reservation_id TEXT NOT NULL, user_id TEXT NOT NULL,
        ${reservationColumns}, PRIMARY KEY(bot_id,source,reservation_id)) WITHOUT ROWID`,
    `CREATE INDEX {fund_expiry} ON {reservations}(bot_id,expires_at_ms,reservation_id,source) WHERE status='active'`,
    `CREATE TABLE {sources} (bot_id TEXT NOT NULL, source TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
        operation_permissions TEXT NOT NULL CHECK(json_valid(operation_permissions)),
        read_permissions TEXT NOT NULL CHECK(json_valid(read_permissions)), ${version('policy_version')},
        PRIMARY KEY(bot_id,source)) WITHOUT ROWID`,
    `CREATE TABLE {wallet_state} (bot_id TEXT PRIMARY KEY, ${version('ledger_revision')}, qq_transfer_enabled INTEGER NOT NULL DEFAULT 0 CHECK(qq_transfer_enabled IN (0,1)),
        qq_fee_mode TEXT NOT NULL DEFAULT 'free' CHECK(qq_fee_mode IN ('free','proportional')),
        ${money('qq_fee_numerator')}, qq_fee_denominator INTEGER NOT NULL DEFAULT 1
        CHECK(typeof(qq_fee_denominator)='integer' AND qq_fee_denominator BETWEEN 1 AND ${SAFE}), ${version('policy_version')},
        schema_version INTEGER NOT NULL CHECK(schema_version=1), format TEXT NOT NULL,
        init_state TEXT NOT NULL CHECK(init_state='ready'),
        guard_token TEXT, guard_time INTEGER, guard_code TEXT,
        guard_ready INTEGER NOT NULL DEFAULT 1 CHECK(guard_ready=1))`,
    `CREATE TABLE {transfer_intents} (intent_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, from_user_id TEXT NOT NULL,
        to_user_id TEXT NOT NULL, ${money('amount_minor')}, ${money('fee_minor')}, fee_policy_version INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL, origin_message_id TEXT NOT NULL,
        request_hash TEXT NOT NULL, confirmation_code TEXT NOT NULL,
        CHECK(amount_minor>0 AND amount_minor<=${SAFE}-fee_minor), CHECK(from_user_id!=to_user_id)) WITHOUT ROWID`
] as const;
// 针对所选机器人的钱包行验证，提交批次内也执行此检查。
export const WALLET_READY = `schema_version=1 AND format='${SCHEMA_FORMAT}' AND init_state='ready'`;
interface SchemaMarker {
    schema_version: number;
    format: string;
    init_state: string;
    bot_id: string;
}

async function marker(db: PluginDB, bot: string): Promise<SchemaMarker | null | undefined> {
    try {
        return await db.first<SchemaMarker>(`SELECT bot_id,schema_version,format,init_state
            FROM {wallet_state} WHERE bot_id=?`, bot);
    } catch (error) {
        // 只有钱包表缺失时才允许执行原子 DDL；缺少机器人行时不建表。
        if (error instanceof Error && /no such table: (?:\w+\.)?p_points_wallet_state\b/.test(error.message)) {
            return undefined;
        }

        throw error;
    }
}

function checkMarker(value: unknown): asserts value is SchemaMarker {
    if (!value || typeof value !== 'object' || !('schema_version' in value) || value.schema_version !== SCHEMA_VERSION
        || !('format' in value) || value.format !== SCHEMA_FORMAT || !('init_state' in value) || value.init_state !== 'ready') {
        throw new PointsFault('INTERNAL_ERROR', true);
    }
}

function botDefaults(botId: string, anchor?: string) {
    return [
        statement(`INSERT INTO {wallet_state}(bot_id,schema_version,format,init_state)
            SELECT ?,1,?,'ready' ${anchor === undefined ? '' : `FROM {wallet_state} WHERE bot_id=? AND ${WALLET_READY}`}
            ${anchor === undefined ? 'WHERE 1' : ''} ON CONFLICT(bot_id) DO NOTHING`, botId, SCHEMA_FORMAT, ...(anchor === undefined ? [] : [anchor])),
        statement(`INSERT OR IGNORE INTO {sources}(bot_id,source,enabled,operation_permissions,read_permissions)
            SELECT ?,column1,1,column2,column3 FROM (VALUES
                ('admin','["burn","transfer","reverseOwn","settle","release"]','["balance","transactions"]'),
                ('points.qq','["transfer"]','["balance","transactions"]'),('points.system','["release"]','[]'))
            WHERE EXISTS(SELECT 1 FROM {wallet_state} WHERE bot_id=? AND ${WALLET_READY})`, botId, botId)
    ];
}

async function initializeBot(ctx: Pick<PluginContext, 'db' | 'botId'>): Promise<void> {
    // 当前格式标记证明共享 DDL 已提交；不接管空表或无标记的表。
    const anchor = await ctx.db.first<SchemaMarker>('SELECT bot_id,schema_version,format,init_state FROM {wallet_state} LIMIT 1');
    checkMarker(anchor);

    try {
        await ctx.db.batch(botDefaults(ctx.botId, anchor.bot_id));
    } catch (error) {
        // 两项默认记录在同一批次创建；本机器人的当前格式标记可用于恢复丢失的响应。
        const recovered = await marker(ctx.db, ctx.botId);

        if (!recovered) {
            throw error;
        }

        checkMarker(recovered);

        return;
    }

    checkMarker(await marker(ctx.db, ctx.botId));
}

export async function ensureSchemaReady(ctx: Pick<PluginContext, 'db' | 'botId'>, deferBusiness = false): Promise<void> {
    const created = await requestReadiness(ctx.db, ctx.botId, () => initialize(ctx));

    if (created && deferBusiness) {
        throw new PointsFault('BUSY', true);
    }
}

// 已有业务读取同时取得格式标记；只有缺表或缺机器人时进入统一初始化。
export async function readReady<T>(ctx: Pick<PluginContext, 'db' | 'botId'>, read: () => Promise<T>,
    getMarker: (result: T) => unknown, deferBusiness = false): Promise<T> {
    if (deferBusiness) { await deferInitializedBusiness(ctx.db, ctx.botId); }

    let result: T;

    try {
        result = await read();
        const value = getMarker(result);

        if (value) {
            checkMarker(value);

            return result;
        }
    } catch (error) {
        if (!(error instanceof Error) || !/no such table: (?:\w+\.)?p_points_\w+\b/.test(error.message)) {
            throw error;
        }
    }

    await ensureSchemaReady(ctx, deferBusiness);
    result = await read();
    checkMarker(getMarker(result));

    return result;
}

async function initialize(ctx: Pick<PluginContext, 'db' | 'botId'>): Promise<boolean> {
    const existing = await marker(ctx.db, ctx.botId);

    if (existing) {
        checkMarker(existing);

        return false;
    }

    if (existing === null) {
        await initializeBot(ctx);

        return false;
    }

    try {
        await ctx.db.batch([...SCHEMA_DDL.map(sql => statement(sql)), ...botDefaults(ctx.botId)]);
    } catch (error) {
        // 其他机器人可能已完成首次安装；不重复执行 DDL，也不覆盖其政策。
        const concurrent = await marker(ctx.db, ctx.botId);

        if (concurrent === undefined) {
            throw error;
        }

        if (concurrent) {
            checkMarker(concurrent);
        } else {
            await initializeBot(ctx);
        }
    }

    return true;
}

export const DECISION_TIME_SQL = DATABASE_NOW_MS;
