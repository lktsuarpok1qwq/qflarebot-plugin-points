import { LedgerPlan } from './ledger/plan.js';
import { requireCondition } from './errors.js';
import { identifier } from './ledger/operations.js';
import { LIMITS } from './limits.js';
import type { FundRow } from './model.js';

export function reserveFund(plan: LedgerPlan, item: Record<string, unknown>, expiresAt: unknown): void {
    plan.permission('reserve');
    const id = identifier(item.reservationId);
    requireCondition(!plan.snapshot.funds.some(row => row.reservation_id === id)
        && !plan.data.funds.some(row => row.reservation_id === id), 'RESERVATION_CONFLICT');
    const amount = plan.amount(item.amountMinor);
    const account = plan.account(item.userId);
    plan.spend(account);
    const row: FundRow = { ...plan.freshReservation(expiresAt), reservation_id: id, user_id: account.user_id, amount_minor: amount };
    plan.move(account, 'available', -amount, { reservationId: id });
    plan.move(account, 'reserved', amount, { reservationId: id });
    plan.data.funds.push(row);
    plan.data.reservationIds.push(id);
    plan.data.type = 'reserve';
}

export function reserveBundle(plan: LedgerPlan): void {
    const funds = plan.input.funds as Record<string, unknown>[];
    requireCondition(funds.length > 0, 'INVALID_ARGUMENT');
    requireCondition(funds.length <= LIMITS.reservations, 'LIMIT_EXCEEDED');

    for (const fund of funds) {
        reserveFund(plan, fund, plan.input.expiresAtMs);
    }
}

export function release(plan: LedgerPlan): void {
    const row = plan.fund(plan.input.reservationId);
    plan.active(row, false);
    plan.recovery(row, 'release');
    releaseFund(plan, row);
}

// 共用资金变动逻辑；调用方负责鉴权，并用完整的来源和编号定位预留。
export function releaseFund(plan: LedgerPlan, row: FundRow): void {
    plan.terminate(row, 'released');
    const account = plan.account(row.user_id);
    plan.move(account, 'reserved', -row.amount_minor, { reservationId: row.reservation_id });
    plan.move(account, 'available', row.amount_minor, { reservationId: row.reservation_id });
    plan.data.type = 'release';
}

export function renew(plan: LedgerPlan): void {
    plan.permission('renew');
    const row = plan.fund(plan.input.reservationId);
    plan.active(row, true);
    const expiry = plan.newDeadline(plan.input.expiresAtMs);
    requireCondition(expiry > row.expires_at_ms, 'INVALID_ARGUMENT');
    requireCondition(expiry <= row.renewal_deadline_ms, 'LIMIT_EXCEEDED');
    row.expires_at_ms = expiry;
    row.renewed_at_ms = 0;
    row.last_operation_id = plan.input.operationId;
    row.last_operation_source = plan.input.source;
    plan.data.renewal = row;
}
