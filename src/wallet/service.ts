import type { PluginContext } from '@qqbot/sdk';
import type { PointsService } from '../contracts.js';
import { mutate } from './mutations.js';
import { queries } from './queries.js';
import { registerSource } from './policies.js';

export function walletService(ctx: PluginContext): PointsService {
    return {
        ...queries(ctx),
        registerSource: input => registerSource(ctx, input),
        credit: input => mutate(ctx, 'credit', input),
        burn: input => mutate(ctx, 'burn', input),
        transfer: input => mutate(ctx, 'transfer', input),
        reserve: input => mutate(ctx, 'reserve', input),
        reserveBundle: input => mutate(ctx, 'reserveBundle', input),
        renewReservation: input => mutate(ctx, 'renewReservation', input),
        release: input => mutate(ctx, 'release', input),
        reverseOwn: input => mutate(ctx, 'reverseOwn', input),
        settle: input => mutate(ctx, 'settle', input)
    };
}
