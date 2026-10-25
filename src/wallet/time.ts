import { requireCondition } from './errors.js';

export const DAY_MS = 86400000;
export const BEIJING_OFFSET_MS = 8 * 3600000;
// 组合 strftime 秒数和毫秒部分，避免 julianday 浮点舍入。
export const DATABASE_NOW_MS = "(CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";

export function beijingDate(timestamp: number): string {
    requireCondition(Number.isSafeInteger(timestamp) && timestamp >= 0, 'INVALID_ARGUMENT');
    const date = new Date(timestamp + BEIJING_OFFSET_MS);
    requireCondition(Number.isFinite(date.getTime()), 'INVALID_ARGUMENT');

    return date.toISOString().slice(0, 10);
}

export function beijingMonth(timestamp: number): string {
    return beijingDate(timestamp).slice(0, 7);
}
