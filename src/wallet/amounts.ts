import { requireCondition } from './errors.js';

// 数值表示边界，与可配置的业务金额上限分开。
export const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;
const MAX_BIGINT = BigInt(MAX_SAFE_MINOR);

export function minor(value: unknown, allowZero = false): number {
    requireCondition(typeof value === 'number' && Number.isSafeInteger(value), 'INVALID_ARGUMENT');
    requireCondition(allowZero ? value >= 0 : value > 0, 'INVALID_ARGUMENT');

    return value;
}

export function safeMinor(value: bigint): number {
    requireCondition(value >= -MAX_BIGINT && value <= MAX_BIGINT, 'LIMIT_EXCEEDED');

    return Number(value);
}

export function sumMinor(values: readonly number[]): number {
    let total = 0n;

    for (const value of values) {
        requireCondition(Number.isSafeInteger(value), 'INVALID_ARGUMENT');
        total += BigInt(value);
    }

    return safeMinor(total);
}

export function parseAmount(text: string): number {
    requireCondition(typeof text === 'string' && /^(0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(text), 'INVALID_ARGUMENT');
    const [whole = '0', fraction = ''] = text.split('.');

    return minor(safeMinor(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))));
}

export function formatAmount(value: number | bigint): string {
    requireCondition(typeof value === 'bigint' || Number.isSafeInteger(value), 'INVALID_ARGUMENT');
    const amount = BigInt(value);
    const absolute = amount < 0n ? -amount : amount;

    return `${amount < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function proportionalFee(amount: number, numerator: number, denominator: number): number {
    minor(amount);
    minor(numerator, true);
    minor(denominator);

    return safeMinor(BigInt(amount) * BigInt(numerator) / BigInt(denominator));
}

export function reportMinor(value: bigint): number | string {
    return value >= -MAX_BIGINT && value <= MAX_BIGINT ? Number(value) : value.toString();
}
