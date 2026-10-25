import type { AccountCredit, SettlementInput } from '../contracts.js';
import { LedgerPlan } from './ledger/plan.js';
import { sumMinor } from './amounts.js';
import { requireCondition } from './errors.js';
import { identifier } from './ledger/operations.js';
import { LIMITS } from './limits.js';

function payouts(plan: LedgerPlan, items: AccountCredit[], reference: {
    reservationId?: string;
}): number {
    requireCondition(new Set(items.map(item => item.userId)).size === items.length, 'INVALID_SETTLEMENT');
    let total = 0;

    for (const item of items) {
        const amount = plan.amount(item.amountMinor);
        total = sumMinor([total, amount]);
        plan.move(plan.account(item.userId), 'available', amount, reference);
    }

    return total;
}

export function settle(plan: LedgerPlan): void {
    const input = plan.input as unknown as SettlementInput;
    identifier(input.referenceId);
    requireCondition(input.funds.length + input.rewards.length > 0, 'INVALID_SETTLEMENT');
    requireCondition(input.funds.length <= LIMITS.reservations, 'LIMIT_EXCEEDED');
    requireCondition(input.funds.reduce((total, item) => total + item.payouts.length, input.rewards.length) <= LIMITS.payouts, 'LIMIT_EXCEEDED');
    requireCondition(new Set(input.funds.map(item => item.reservationId)).size === input.funds.length
        && new Set(input.rewards.map(item => item.userId)).size === input.rewards.length, 'INVALID_SETTLEMENT');

    for (const item of input.funds) {
        const row = plan.fund(item.reservationId);
        plan.active(row, true);
        plan.recovery(row, 'settle');
        requireCondition(row.reference_id === input.referenceId, 'INVALID_SETTLEMENT');
        const reference = { reservationId: row.reservation_id };
        const burn = plan.amount(item.burnMinor, true);
        const paid = payouts(plan, item.payouts, reference);
        requireCondition(sumMinor([paid, burn]) === row.amount_minor, 'INVALID_SETTLEMENT');
        plan.move(plan.account(row.user_id), 'reserved', -row.amount_minor, reference);
        plan.entry('SYSTEM_BURN', 'supply', burn, reference);
        plan.burned = sumMinor([plan.burned, burn]);
        plan.transferred = sumMinor([plan.transferred, ...item.payouts.filter(p => p.userId !== row.user_id).map(p => p.amountMinor)]);
        plan.terminate(row, 'consumed');
    }

    if (input.rewards.length) {
        plan.permission('settle');
        const minted = payouts(plan, input.rewards, {});
        plan.entry('SYSTEM_ISSUANCE', 'supply', -minted);
        plan.minted = minted;
    }

    plan.data.type = 'settle';
}
