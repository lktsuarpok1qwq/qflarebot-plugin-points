import type { OperationContext, PointsService } from '../contracts.js';
import { LIMITS } from './limits.js';
import { identifier, operationContext } from './ledger/operations.js';
import { requireCondition } from './errors.js';

export type Mutation = Exclude<keyof PointsService, 'registerSource' | 'checkAccounts' | 'getSourcePolicy' | 'getBalance' | 'getTransactions' | 'getOperation' | 'getReservations'>;
export type MutationInput = Parameters<PointsService[Mutation]>[0];
export type Input = OperationContext & Record<string, unknown>;
const FIELDS: Record<Mutation, string[]> = {
    credit: ['userId', 'amountMinor'], burn: ['userId', 'amountMinor'],
    transfer: ['fromUserId', 'toUserId', 'amountMinor', 'feeMinor'],
    reserve: ['userId', 'reservationId', 'amountMinor', 'expiresAtMs'],
    renewReservation: ['reservationId', 'expiresAtMs'], release: ['reservationId'],
    reserveBundle: ['expiresAtMs', 'funds'], reverseOwn: ['originalTransactionId'], settle: ['funds', 'rewards']
};

function record(value: unknown): Record<string, unknown> {
    requireCondition(typeof value === 'object' && value !== null && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype, 'INVALID_ARGUMENT');

    return value as Record<string, unknown>;
}

export function pick(value: unknown, fields: string[]): Record<string, unknown> {
    const object = record(value);
    requireCondition(Object.keys(object).every(key => fields.includes(key)), 'INVALID_ARGUMENT');

    return Object.fromEntries(fields.filter(key => object[key] !== undefined).map(key => [key, object[key]]));
}

export function vector(value: unknown, fields: string[], key: string, payouts = false): Record<string, unknown>[] {
    requireCondition(Array.isArray(value) && value.length <= 128, 'LIMIT_EXCEEDED');
    const items = value.map(item => pick(item, fields));

    for (const item of items) {
        identifier(item[key]);

        if (payouts) {
            item.payouts = vector(item.payouts, ['userId', 'amountMinor'], 'userId');
        }
    }

    return items.sort((a, b) => String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0);
}

export function normalize(method: Mutation, value: unknown, internal = false): Input {
    const result = pick(value, ['source', 'operationId', 'referenceId', 'reason', ...FIELDS[method]]) as Input;
    operationContext(result, internal);

    if (method === 'transfer' && result.feeMinor === undefined) {
        result.feeMinor = 0;
    }

    if (method === 'reserveBundle') {
        result.funds = vector(result.funds, ['userId', 'reservationId', 'amountMinor'], 'reservationId');
    }

    if (method === 'settle') {
        result.funds = vector(result.funds, ['reservationId', 'payouts', 'burnMinor'], 'reservationId', true);
        result.rewards = vector(result.rewards, ['userId', 'amountMinor'], 'userId');
    }

    // 文本和集合的解析上限固定，在政策检查和幂等重放之前校验。
    for (const key of FIELDS[method].filter(key => key.endsWith('Id'))) {
        identifier(result[key]);
    }

    requireCondition(result.reason === undefined || String(result.reason).length <= LIMITS.reasonCharacters, 'INVALID_ARGUMENT');

    return result;
}

const ADMIN_FIELDS = {
    status: ['userId', 'status'],
    compensate: ['originalTransactionId', 'credits', 'burns'],
    release: ['targetSource', 'reservationId']
};

export function normalizeAdmin(action: keyof typeof ADMIN_FIELDS, value: unknown): Record<string, unknown> & {
    operationId: string;
} {
    const input = pick(value, ['operationId', 'reason', 'referenceId', ...ADMIN_FIELDS[action]]);

    if (action === 'compensate') {
        input.credits = vector(input.credits, ['userId', 'amountMinor'], 'userId');
        input.burns = vector(input.burns, ['userId', 'amountMinor'], 'userId');
    }

    return { ...input, operationId: identifier(input.operationId) };
}
