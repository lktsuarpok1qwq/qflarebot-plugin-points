export const LIMITS = Object.freeze({
    amountMinor: 1000000000000,
    reservations: 32,
    payouts: 32,
    accounts: 32,
    entries: 96,
    requestBytes: 65536,
    idCharacters: 128,
    reasonCharacters: 256,
    pageSize: 50,
    reservationWindowMs: 30 * 86400000,
    reservationLifetimeMs: 180 * 86400000,
    intentLifetimeMs: 5 * 60000
});
