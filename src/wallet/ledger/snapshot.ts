import { requireLedger } from './ledger.js';
import type { DBStatement, PluginContext } from '@qqbot/sdk';
import type { Input, Mutation } from '../input.js';
import type { AccountRow, SourceRow, Snapshot } from '../model.js';
import { DATABASE_NOW_MS } from '../time.js';
import { idChunks, operationPermissionSql, placeholders, statement } from '../storage/sql.js';
import { readReady } from '../storage/schema.js';
import type { OperationRow } from './operations.js';
import { identifier } from './operations.js';
import { LIMITS } from '../limits.js';
import { reservationRead, reservationRows } from '../reservation-queries.js';

type ReadContext = Pick<PluginContext, 'db' | 'botId'>;
const ACCOUNT_COLUMNS = ['bot_id', 'user_id', 'available_minor', 'reserved_minor', 'status', 'version', 'created_at_ms', 'updated_at_ms'];

function packedAccounts(bot: string, ids: unknown[]): string {
    return `json_array(${ids.map(() => `json((SELECT json_object(${ACCOUNT_COLUMNS.map(column => `'${column}',a.${column}`).join(',')})
        FROM {accounts} a WHERE a.bot_id=${bot} AND a.user_id=?))`).join(',')}) AS accounts_json`;
}

function accountRead(bot: string, ids: unknown[]): DBStatement {
    // 正常多人业务逐个按完整主键读取；超限输入分块读取，由业务层持久化拒绝。
    return ids.length > 1 && ids.length <= LIMITS.accounts
        ? statement('SELECT ' + packedAccounts('?', ids), ...ids.flatMap(id => [bot, id]))
        : statement(`SELECT * FROM {accounts} WHERE bot_id=? AND user_id IN (${placeholders(ids)})`, bot, ...ids);
}

function accountsFromRows(rows: Record<string, unknown>[]): AccountRow[] {
    return rows.flatMap(row => 'accounts_json' in row
        ? (JSON.parse(row.accounts_json as string) as (AccountRow | null)[]).filter((account): account is AccountRow => account !== null)
        : row.user_id ? [Object.fromEntries(ACCOUNT_COLUMNS.map(column => [column, row[column]])) as unknown as AccountRow] : []);
}

export function emptySnapshot(bot: string, meta: Record<string, unknown>): Snapshot {
    return {
        bot, now: meta.now as number, revision: meta.ledger_revision as number, source: null,
        accounts: [], funds: [], original: null, reversed: false
    };
}

export function readSnapshot(ctx: ReadContext, method: Mutation, input: Input): Promise<Snapshot>;

export function readSnapshot(ctx: ReadContext, method: Mutation, input: Input, restoreOperation: true, operationSource?: string): Promise<Snapshot | OperationRow>;

export async function readSnapshot(ctx: ReadContext, method: Mutation, input: Input, restoreOperation = false, operationSource = input.source): Promise<Snapshot | OperationRow> {
    const fundItems = Array.isArray(input.funds) ? input.funds as Record<string, unknown>[] : [];
    const fundIds = fundItems.map(item => item.reservationId);

    if (input.reservationId) {
        fundIds.push(input.reservationId);
    }

    const users = new Set<unknown>([input.userId, input.fromUserId, input.toUserId].filter(Boolean));

    for (const item of fundItems) {
        if (item.userId) {
            users.add(item.userId);
        }

        for (const payout of (item.payouts ?? []) as {
            userId: string;
        }[]) {
            users.add(payout.userId);
        }
    }

    for (const item of [...(Array.isArray(input.rewards) ? input.rewards : []), ...(Array.isArray(input.credits) ? input.credits : []), ...(Array.isArray(input.burns) ? input.burns : [])]) {
        users.add((item as {
            userId: string;
        }).userId);
    }

    const reversal = method === 'reverseOwn' && input.action !== 'admin.compensate';
    const needsAccounts = method !== 'renewReservation';
    const dependentAccounts = needsAccounts && ((fundIds.length > 0 && method !== 'reserve' && method !== 'reserveBundle')
        || (reversal && !!input.originalTransactionId));
    const reads: {
        key: string;
        sql: DBStatement;
    }[] = [];
    const add = (key: string, sql: DBStatement) => reads.push({ key, sql });
    const needsSource = method !== 'release' && input.action !== 'admin.status'
        && (method !== 'settle' || (input.rewards as unknown[]).length > 0);
    const knownUsers = needsAccounts && !dependentAccounts ? [...users] : [];
    // 非标量输入留到原结果恢复之后处理，不能让绑定异常抢先覆盖幂等冲突。
    const joinedUsers = knownUsers.length <= 80 && knownUsers.every(user => typeof user === 'string') ? knownUsers : [];
    const pairedAccounts = method === 'transfer' && joinedUsers.length === 2;
    const packed = !pairedAccounts && joinedUsers.length > 1 && joinedUsers.length <= LIMITS.accounts;
    // 重放时将业务查询的主键置空，避免先命中来源/账户再过滤带来的额外读行。
    const businessBot = restoreOperation ? 'CASE WHEN o.operation_id IS NULL THEN m.bot_id END' : 'm.bot_id';
    // 这些普通业务先校验来源；结算和管理员恢复的错误顺序不同，仍读取原有快照。
    const checkSource = !input.action && method !== 'release' && method !== 'settle';
    const permission = method === 'credit' ? null : method === 'reserveBundle' ? 'reserve'
        : method === 'renewReservation' ? 'renew' : method;
    const accountBot = checkSource
        ? `CASE WHEN s.enabled=1 ${permission ? `AND ${operationPermissionSql(permission)}` : ''} THEN ${businessBot} END`
        : businessBot;
    // 双人转账使用独立连接；其他正常多人快照将账户 JSON 与元数据分开返回。
    const accountProjection = pairedAccounts
        ? ['sender', 'recipient'].flatMap(alias => ACCOUNT_COLUMNS.map(column => `${alias}.${column} AS ${alias}_${column}`)).join(',')
        : packed ? packedAccounts(accountBot, joinedUsers) : 'a.*';
    // 即使来源或账户缺失，也保留一行快照，由业务校验确定原始错误；
    // 不将预留与账户做交叉连接。
    add('base', statement(`SELECT m.ledger_revision, ${DATABASE_NOW_MS} AS now
        ${restoreOperation ? ',m.schema_version,m.format,m.init_state,o.request_hash AS operation_hash,o.status AS operation_status,o.result_json AS operation_result' : ''}
        ${needsSource ? ',s.source,s.enabled,s.operation_permissions,s.read_permissions,s.policy_version' : ''}
        ${joinedUsers.length ? ',' + accountProjection : ''} FROM {wallet_state} m
        ${restoreOperation ? 'LEFT JOIN {operations} o ON o.bot_id=m.bot_id AND o.source=? AND o.operation_id=?' : ''}
        ${needsSource ? `LEFT JOIN {sources} s ON s.bot_id=${businessBot} AND s.source=?` : ''}
        ${pairedAccounts ? `LEFT JOIN {accounts} sender ON sender.bot_id=${accountBot} AND sender.user_id=?
            LEFT JOIN {accounts} recipient ON recipient.bot_id=${accountBot} AND recipient.user_id=?`
            : joinedUsers.length && !packed ? `LEFT JOIN {accounts} a ON a.bot_id=${accountBot} AND a.user_id IN (${placeholders(joinedUsers)})` : ''}
        WHERE m.bot_id=?`, ...(packed ? joinedUsers : []), ...(restoreOperation ? [operationSource, input.operationId] : []), ...(needsSource ? [input.source] : []), ...(!packed ? joinedUsers : []), ctx.botId));

    for (const ids of idChunks(fundIds)) {
        add('funds', reservationRead(ctx.botId, input.source, ids));
    }

    if (input.originalTransactionId) {
        add('original', statement('SELECT * FROM {transactions} WHERE bot_id=? AND tx_id=?', ctx.botId, input.originalTransactionId));

        if (reversal) {
            add('reversed', statement('SELECT tx_id FROM {transactions} WHERE bot_id=? AND reverses_tx_id=?', ctx.botId, input.originalTransactionId));
        }
    }

    if (knownUsers.length && !joinedUsers.length) {
        for (const ids of idChunks(knownUsers)) {
            add('accounts', accountRead(ctx.botId, ids));
        }
    }

    const rows: Record<string, Record<string, unknown>[]> = {};

    if (restoreOperation) {
        const initial = reads.shift()!.sql;
        rows.base = await readReady(ctx, () => ctx.db.all<Record<string, unknown>>(initial.sql, ...(initial.params ?? [])), value => value[0], true);
        const first = rows.base[0]!;

        if (first.operation_hash !== null) {
            return { request_hash: first.operation_hash as string, status: first.operation_status as OperationRow['status'], result_json: first.operation_result as string };
        }
    }

    // 目标本金来源的校验仍晚于 admin 操作重放，且先于实际本金读取。
    if (operationSource !== input.source) { identifier(input.source); }

    const initial = rows.base?.[0];
    const sourceRejected = checkSource && initial && (initial.enabled !== 1
        || (permission !== null && !(JSON.parse(initial.operation_permissions as string) as string[]).includes(permission)));

    if (reads.length && !sourceRejected) {
        const results = await ctx.db.batch<Record<string, unknown>>(reads.map(read => read.sql));
        reads.forEach((read, i) => (rows[read.key] ??= []).push(...results[i]!.results));
    }

    const base = rows.base![0]!;
    const snapshot = emptySnapshot(ctx.botId, base);
    snapshot.source = base.source ? {
        bot_id: ctx.botId, source: base.source, enabled: base.enabled,
        operation_permissions: base.operation_permissions, read_permissions: base.read_permissions,
        policy_version: base.policy_version
    } as SourceRow : null;
    snapshot.funds = reservationRows(rows.funds ?? []);
    snapshot.original = (rows.original?.[0] ?? null) as unknown as Snapshot['original'];
    snapshot.reversed = !!rows.reversed?.length;
    // 移除连接查询的元数据，因为账户写入器将行的键名用作实际列名。
    snapshot.accounts = pairedAccounts ? ['sender', 'recipient'].filter(alias => base[alias + '_user_id']).map(alias =>
        Object.fromEntries(ACCOUNT_COLUMNS.map(column => [column, base[alias + '_' + column]])) as unknown as AccountRow)
        : accountsFromRows(joinedUsers.length ? rows.base! : rows.accounts ?? []);

    for (const fund of snapshot.funds) {
        users.add(fund.user_id);
    }

    if (reversal && snapshot.original) {
        const ledger = requireLedger(snapshot.original.ledger_json, snapshot.original.expected_entry_count);

        for (const entry of ledger.entries) {
            if (entry.bucket !== 'supply') {
                users.add(entry.accountId);
            }
        }
    }

    if (dependentAccounts && users.size && !sourceRejected) {
        const values = await ctx.db.batch<Record<string, unknown>>(idChunks([...users]).map(ids => accountRead(ctx.botId, ids)));
        snapshot.accounts = accountsFromRows(values.flatMap(value => value.results));
    }

    return snapshot;
}
