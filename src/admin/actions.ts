import type { PluginContext } from '@qqbot/sdk';
import type { AccountCredit, OperationReceipt, PointsErrorCode, Result } from '../contracts.js';
import type { Input } from '../wallet/input.js';
import { normalizeAdmin } from '../wallet/input.js';
import { requireCondition, PointsFault, systemFailure } from '../wallet/errors.js';
import { identifier, operationContext, replay, requestHash } from '../wallet/ledger/operations.js';
import { readSnapshot } from '../wallet/ledger/snapshot.js';
import { LedgerPlan } from '../wallet/ledger/plan.js';
import { commit } from '../wallet/ledger/commit.js';
import { release } from '../wallet/reservations.js';
import { sumMinor } from '../wallet/amounts.js';
import { LIMITS } from '../wallet/limits.js';

export async function administrativeAction(ctx: PluginContext, action: 'status' | 'compensate' | 'release', value: Record<string, unknown>): Promise<Result<OperationReceipt>> {
    try {
        const input = { ...normalizeAdmin(action, value), source: 'admin', action: 'admin.' + action } as Input;
        operationContext(input, true);
        requireCondition(typeof input.reason === 'string' && input.reason.trim().length > 0, 'INVALID_ARGUMENT');
        const hash = await requestHash('admin.' + action, input);
        const readInput = action === 'release' ? { ...input, source: input.targetSource as string } : input;
        // 管理员操作按 admin 恢复回执，本金仍按原业务来源定位。
        const snapshot = await readSnapshot(ctx, action === 'release' ? 'release' : 'reverseOwn', readInput, true, input.source);

        if ('request_hash' in snapshot) {
            return replay(snapshot, hash);
        }

        const plan = new LedgerPlan(snapshot, input);
        let rejection: PointsErrorCode | undefined;

        try {
            if (action === 'status') {
                requireCondition(['active', 'suspended'].includes(String(input.status)), 'INVALID_ARGUMENT');
                plan.account(input.userId).status = input.status as 'active' | 'suspended';
            } else if (action === 'release') {
                identifier(input.reservationId);
                release(plan);
            } else {
                identifier(input.originalTransactionId);
                requireCondition(snapshot.original, 'TRANSACTION_NOT_FOUND');
                const credits = input.credits as AccountCredit[];
                const burns = input.burns as AccountCredit[];
                requireCondition(Array.isArray(credits) && Array.isArray(burns), 'INVALID_ARGUMENT');
                requireCondition(credits.length + burns.length > 0 && credits.length + burns.length <= LIMITS.payouts, 'LIMIT_EXCEEDED');
                requireCondition(new Set(credits.map(p => p.userId)).size === credits.length
                    && new Set(burns.map(p => p.userId)).size === burns.length, 'INVALID_ARGUMENT');

                if (credits.length) {
                    plan.enabledSource();
                }

                if (burns.length) {
                    plan.permission('burn');
                }

                for (const item of burns) {
                    const amount = plan.amount(item.amountMinor);
                    plan.move(plan.account(item.userId), 'available', -amount);
                    plan.entry('SYSTEM_BURN', 'supply', amount);
                    plan.burned = sumMinor([plan.burned, amount]);
                }

                for (const item of credits) {
                    const amount = plan.amount(item.amountMinor);
                    plan.move(plan.account(item.userId), 'available', amount);
                    plan.entry('SYSTEM_ISSUANCE', 'supply', -amount);
                    plan.minted = sumMinor([plan.minted, amount]);
                }

                plan.data.type = 'compensate';
                plan.data.compensation = snapshot.original.tx_id;
            }

            plan.finish();
        } catch (error) {
            if (!(error instanceof PointsFault) || error.retryable || error.code === 'INTERNAL_ERROR') {
                throw error;
            }

            rejection = error.code;
        }

        return await commit(ctx, input, hash, plan, rejection);
    } catch (error) {
        return systemFailure(error);
    }
}
