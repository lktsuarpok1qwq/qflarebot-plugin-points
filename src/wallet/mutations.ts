import type { PluginContext } from '@qqbot/sdk';
import type { OperationReceipt, PointsErrorCode, Result } from '../contracts.js';
import type { Mutation } from './input.js';
import { normalize } from './input.js';
import { replay, requestHash } from './ledger/operations.js';
import { readSnapshot } from './ledger/snapshot.js';
import { LedgerPlan } from './ledger/plan.js';
import { PointsFault, systemFailure } from './errors.js';
import { credit, burn, transfer, reverseOwn } from './transactions.js';
import { reserveFund, reserveBundle, renew, release } from './reservations.js';
import { settle } from './settlement.js';
import { commit } from './ledger/commit.js';

export async function mutate(ctx: PluginContext, method: Mutation, value: unknown, internal = false): Promise<Result<OperationReceipt>> {
    try {
        const input = normalize(method, value, internal);
        const hash = await requestHash(method, input);
        const snapshot = await readSnapshot(ctx, method, input, true);

        if ('request_hash' in snapshot) {
            return replay(snapshot, hash);
        }

        const plan = new LedgerPlan(snapshot, input);
        let rejection: PointsErrorCode | undefined;

        try {
            switch (method) {
                case 'credit':
                    credit(plan);
                    break;
                case 'burn':
                    burn(plan);
                    break;
                case 'transfer':
                    transfer(plan);
                    break;
                case 'reverseOwn':
                    reverseOwn(plan);
                    break;
                case 'reserve':
                    reserveFund(plan, input, input.expiresAtMs);
                    break;
                case 'reserveBundle':
                    reserveBundle(plan);
                    break;
                case 'renewReservation':
                    renew(plan);
                    break;
                case 'release':
                    release(plan);
                    break;
                case 'settle':
                    settle(plan);
                    break;
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
