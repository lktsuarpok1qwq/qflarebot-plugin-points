import type { Entry } from '../model.js';
import { requireCondition } from '../errors.js';
import { LIMITS } from '../limits.js';

export interface LedgerBody {
    entries: Array<Entry & { entryNo: number }>;
    minted: number;
    burned: number;
    transferred: number;
    reversalMint: number;
    reversalBurn: number;
}

export function readLedger(json: string, expected: number): LedgerBody | null {
    let body: LedgerBody;

    try {
        body = JSON.parse(json) as LedgerBody;
    } catch {
        return null;
    }

    const validId = (id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= LIMITS.idCharacters
        && !/[\s\u0000-\u001f\u007f]/.test(id);

    if (!body || !Number.isSafeInteger(expected) || expected < 1 || expected > LIMITS.entries
        || !Array.isArray(body.entries) || body.entries.length !== expected
        || !['minted', 'burned', 'transferred', 'reversalMint', 'reversalBurn'].every(key => {
            const amount = body[key as keyof Omit<LedgerBody, 'entries'>];

            return Number.isSafeInteger(amount) && amount >= 0;
        })
        || !body.entries.every((entry, index) => entry && entry.entryNo === index && validId(entry.accountId)
            && ['available', 'reserved', 'supply'].includes(entry.bucket)
            && Number.isSafeInteger(entry.deltaMinor) && entry.deltaMinor !== 0
            && (entry.reservationId === undefined || validId(entry.reservationId)))) {
        return null;
    }

    return body.entries.reduce((sum, entry) => sum + BigInt(entry.deltaMinor), 0n) === 0n ? body : null;
}

export function requireLedger(json: string, expected: number): LedgerBody {
    const body = readLedger(json, expected);
    requireCondition(body, 'INTERNAL_ERROR');

    return body;
}
