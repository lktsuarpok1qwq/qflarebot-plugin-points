import type { PluginContext } from '@qqbot/sdk';
import type { OperationContext, OperationLookup, OperationReceipt, PointsFailure, Result } from '../../contracts.js';
import { failure, requireCondition, success } from '../errors.js';
import { LIMITS } from '../limits.js';
import { INTERNAL_SOURCES, readReady } from '../storage/schema.js';

export interface OperationRow {
    request_hash: string;
    status: 'committed' | 'rejected';
    result_json: string;
}

export function identifier(value: unknown): string {
    requireCondition(typeof value === 'string' && value.length > 0 && value.length <= LIMITS.idCharacters
        && !/[\s\x00-\x1f\x7f]/u.test(value), 'INVALID_ARGUMENT');

    return value;
}

export function sourceId(value: unknown, internal = false): string {
    const source = identifier(value);
    requireCondition(/^[a-z][a-z0-9._-]*$/.test(source), 'INVALID_ARGUMENT');
    requireCondition(internal || !INTERNAL_SOURCES.some(item => item === source), 'SOURCE_NOT_ALLOWED');

    return source;
}

export function operationContext(input: OperationContext, internal = false): void {
    requireCondition(input !== null && typeof input === 'object' && !Array.isArray(input), 'INVALID_ARGUMENT');
    sourceId(input.source, internal);
    identifier(input.operationId);

    if (input.referenceId !== undefined) {
        identifier(input.referenceId);
    }

    if (input.reason !== undefined) {
        requireCondition(typeof input.reason === 'string' && input.reason.length <= LIMITS.reasonCharacters, 'INVALID_ARGUMENT');
    }
}

function canonical(value: unknown, depth: number, budget: {
    remaining: number;
}): string {
    requireCondition(depth <= 8 && budget.remaining-- > 0, 'LIMIT_EXCEEDED');

    if (value === null || typeof value === 'boolean') {
        return JSON.stringify(value);
    }

    if (typeof value === 'number') {
        requireCondition(Number.isSafeInteger(value), 'INVALID_ARGUMENT');

        return JSON.stringify(value);
    }

    if (typeof value === 'string') {
        requireCondition(value.length <= LIMITS.requestBytes, 'LIMIT_EXCEEDED');

        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        requireCondition(value.length <= 128, 'LIMIT_EXCEEDED');

        return '[' + value.map(item => canonical(item, depth + 1, budget)).join(',') + ']';
    }

    requireCondition(typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype, 'INVALID_ARGUMENT');
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).filter(key => object[key] !== undefined).sort();
    requireCondition(keys.length <= 32, 'LIMIT_EXCEEDED');

    return '{' + keys.map(key => JSON.stringify(key) + ':' + canonical(object[key], depth + 1, budget)).join(',') + '}';
}

export async function requestHash(method: string, input: unknown): Promise<string> {
    const body = canonical({ contract: 'points.wallet/V1-core', method, input }, 0, { remaining: 2048 });
    const bytes = new TextEncoder().encode(body);
    requireCondition(bytes.byteLength <= LIMITS.requestBytes, 'LIMIT_EXCEEDED');

    return sha256(bytes);
}

export async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);

    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

// 独立操作查询同时校验本机器人的格式；资金提交在原子批次内读取永久结果。
export async function readReadyOperation(ctx: Pick<PluginContext, 'db' | 'botId'>, source: string, id: string, deferBusiness = false): Promise<(OperationRow & { reason: string | null }) | null> {
    const row = await readReady(ctx, () => ctx.db.first<OperationRow & { reason: string | null }>(`SELECT m.schema_version,m.format,m.init_state,
        o.request_hash,o.status,o.result_json,o.reason FROM {wallet_state} m LEFT JOIN {operations} o
        ON o.bot_id=m.bot_id AND o.source=? AND o.operation_id=? WHERE m.bot_id=?`, source, id, ctx.botId), value => value, deferBusiness);

    return row?.request_hash === null ? null : row ?? null;
}

export function replay(row: OperationRow, hash: string): Result<OperationReceipt> {
    return row.request_hash === hash ? JSON.parse(row.result_json) as Result<OperationReceipt> : failure('OPERATION_CONFLICT');
}

export function lookup(row: OperationRow | null): Result<OperationLookup> {
    if (!row) {
        return success({ status: 'NOT_FOUND' });
    }

    const result = JSON.parse(row.result_json) as Result<OperationReceipt>;

    return result.ok ? success({ status: 'COMMITTED', receipt: result.data })
        : success({
            status: 'REJECTED', error: result as PointsFailure & {
                retryable: false;
            }
        });
}
