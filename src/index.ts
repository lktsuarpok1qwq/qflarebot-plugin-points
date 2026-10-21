import { definePlugin } from '@qqbot/sdk';
import { adminRoutes } from './admin/routes.js';
import { boundedContext } from './wallet/storage/runtime.js';
import { expiryStep } from './wallet/maintenance.js';
import { commands } from './messages/commands.js';
import { walletService } from './wallet/service.js';
import { loadReplySettings } from './messages/reply-settings.js';
import { replyFailure } from './messages/reply-message.js';
import { systemFailure } from './wallet/errors.js';

export type * from './contracts.js';
export default definePlugin({
    name: 'points', displayName: '通用积分', description: '通用积分钱包、原子账本与预留结算', apiVersion: 4,
    permissions: ['db', 'admin'],
    configSchema: { type: 'object', properties: {} },
    commands: Object.fromEntries(Object.entries(commands).map(([name, spec]) => [name, {
        ...spec,
        handler: async (input: import('@qqbot/sdk').CommandInput) => {
            const ctx = boundedContext(input.ctx);

            try {
                const settings = await loadReplySettings(ctx);

                return await spec.handler({ ...input, ctx: { ...ctx, config: { replies: settings.replies, replyConfiguration: settings } } });
            } catch (error) {
                return replyFailure(ctx, systemFailure(error));
            }
        }
    }])),
    ui: { path: '/ui/', title: '积分管理' },
    routes: adminRoutes,
    cron: {
        'points-expiry': {
            cron: '* * * * *', handler: async ({ ctx }) => {
                await expiryStep(boundedContext(ctx));
            }
        }
    },
    services: { 'points.wallet': ctx => walletService(boundedContext(ctx)) }
});
