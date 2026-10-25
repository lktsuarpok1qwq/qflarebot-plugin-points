import { LedgerPlan } from './ledger/plan.js';
import { requireCondition } from './errors.js';
import { sumMinor } from './amounts.js';
import { requireLedger } from './ledger/ledger.js';

export function credit(plan: LedgerPlan): void {
    plan.enabledSource();
    const amount = plan.amount(plan.input.amountMinor);
    const account = plan.account(plan.input.userId);
    plan.move(account, 'available', amount);
    plan.entry('SYSTEM_ISSUANCE', 'supply', -amount);
    plan.data.type = 'mint';
    plan.minted = amount;
}

export function burn(plan: LedgerPlan): void {
    plan.permission('burn');
    const amount = plan.amount(plan.input.amountMinor);
    const account = plan.account(plan.input.userId);
    plan.spend(account);
    plan.move(account, 'available', -amount);
    plan.entry('SYSTEM_BURN', 'supply', amount);
    plan.data.type = 'burn';
    plan.burned = amount;
}

export function transfer(plan: LedgerPlan): void {
    plan.permission('transfer');
    const amount = plan.amount(plan.input.amountMinor);
    const fee = plan.amount(plan.input.feeMinor, true);
    const total = plan.amount(sumMinor([amount, fee]));
    requireCondition(plan.input.fromUserId !== plan.input.toUserId, 'INVALID_ARGUMENT');
    const sender = plan.account(plan.input.fromUserId);
    const recipient = plan.account(plan.input.toUserId);
    plan.spend(sender);
    plan.move(sender, 'available', -total);
    plan.move(recipient, 'available', amount);
    plan.entry('SYSTEM_BURN', 'supply', fee);
    plan.data.type = 'transfer';
    plan.burned = fee;
    plan.transferred = amount;
}

export function reverseOwn(plan: LedgerPlan): void {
    plan.permission('reverseOwn');
    const original = plan.snapshot.original;
    requireCondition(original, 'TRANSACTION_NOT_FOUND');
    requireCondition((plan.input.source === 'admin' || original.source === plan.input.source) && original.reference_id === (plan.input.referenceId ?? null), 'SOURCE_NOT_ALLOWED');
    requireCondition(['mint', 'burn', 'transfer'].includes(original.type), 'REVERSAL_NOT_SUPPORTED');
    requireCondition(!plan.snapshot.reversed, 'ALREADY_REVERSED');
    const ledger = requireLedger(original.ledger_json, original.expected_entry_count);

    // 先扣回再补发，避免同一操作的入账掩盖可用余额不足。
    for (const entry of [...ledger.entries].sort((a, b) => b.deltaMinor - a.deltaMinor)) {
        if (entry.bucket === 'supply') {
            plan.entry(entry.accountId, 'supply', -entry.deltaMinor);
        } else {
            requireCondition(entry.bucket === 'available', 'REVERSAL_NOT_SUPPORTED');
            plan.move(plan.account(entry.accountId), 'available', -entry.deltaMinor);
        }
    }

    plan.data.type = 'reverse';
    plan.data.reversal = original.tx_id;
    plan.reversalMint = ledger.minted;
    plan.reversalBurn = ledger.burned;
}
