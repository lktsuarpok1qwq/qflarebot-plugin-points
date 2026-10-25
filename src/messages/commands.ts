import type { CommandHandler } from '@qqbot/sdk';
import { formatAmount, parseAmount } from '../wallet/amounts.js';
import { ownBalance, openOwnAccount } from '../wallet/accounts.js';
import { queries } from '../wallet/queries.js';
import { createTransferIntent, executeTransferIntent } from '../wallet/intents.js';
import { systemFailure } from '../wallet/errors.js';
import { replyMessage, replyFailure, configuration } from './reply-message.js';
import { replyPresentation } from './presentation.js';

// 只复用固定语言和时区的格式化器；首次展示非空流水时才创建。
let historyTimeFormatter: Intl.DateTimeFormat | undefined;

function formatHistoryTime(value: number): string {
    historyTimeFormatter ??= new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric'
    });

    return historyTimeFormatter.format(new Date(value));
}

const openCommand: CommandHandler = async ({ ctx, session, args }) => {
    if (session.scene !== 'c2c') { return replyMessage(ctx, 'privateOnly'); }

    if (args.length) { return replyMessage(ctx, 'openUsage'); }

    try {
        await openOwnAccount(ctx, session.userId);

        return replyMessage(ctx, 'opened', { userId: session.userId });
    } catch (error) { return replyFailure(ctx, systemFailure(error)); }
};
const balanceCommand: CommandHandler = async ({ ctx, session }) => {
    if (session.scene !== 'c2c') {
        return replyMessage(ctx, 'privateOnly');
    }

    try {
        const data = await ownBalance(ctx, session.userId);

        return replyMessage(ctx, 'balance', {
            userId: session.userId, available: formatAmount(data.availableMinor), reserved: formatAmount(data.reservedMinor),
            total: formatAmount(data.totalMinor), status: data.status === 'active' ? '正常' : '暂停主动支出'
        });
    } catch (error) {
        return replyFailure(ctx, systemFailure(error));
    }
};
const transactionsCommand: CommandHandler = async ({ ctx, session, args }) => {
    if (session.scene !== 'c2c') {
        return replyMessage(ctx, 'privateOnly');
    }

    const result = await queries(ctx, true).getTransactions({
        source: 'points.qq', userId: session.userId, limit: replyPresentation.historyLimit,
        ...(args[0] ? { cursor: args[0] } : {})
    });

    if (!result.ok) {
        return replyFailure(ctx, result);
    }

    const records = result.data.items.map(item => ({
        time: formatHistoryTime(item.createdAtMs), type: item.type,
        available: formatAmount(item.availableDeltaMinor), reserved: formatAmount(item.reservedDeltaMinor),
        reason: item.reason ?? item.referenceId ?? item.transactionId, transactionId: item.transactionId,
        source: item.source, referenceId: item.referenceId ?? ''
    }));

    return replyMessage(ctx, 'history', { userId: session.userId, month: result.data.month, items: replyPresentation.history(configuration(ctx), records) }, result.data.nextCursor ? { next: `积分 流水 ${result.data.nextCursor}` } : {}, ['items']);
};
const transferCommand: CommandHandler = async ({ ctx, session, args }) => {
    if (session.scene !== 'c2c') {
        return replyMessage(ctx, 'privateOnly');
    }

    try {
        if (['确认', '取消'].includes(args[0] ?? '') && args.length === 3) {
            const result = await executeTransferIntent(ctx, session.userId, args[1]!, args[2]!, args[0] === '确认' ? 'confirm' : 'cancel');

            return result.ok ? replyMessage(ctx, 'transferCompleted', { transactionId: result.data.transactionId ?? '' }) : replyFailure(ctx, result);
        }

        if (args.length !== 2) {
            return replyMessage(ctx, 'transferUsage');
        }

        const result = await createTransferIntent(ctx, session.userId, args[0]!, parseAmount(args[1]!), session.messageId ?? '');

        if (!result.ok) {
            return replyFailure(ctx, result);
        }

        const intent = result.data;

        if (intent.status !== 'pending') {
            const terminal = intent.result;

            return terminal.ok ? replyMessage(ctx, 'transferCompleted', { transactionId: terminal.data.transactionId ?? '' }) : replyFailure(ctx, terminal);
        }

        return replyMessage(ctx, 'transferPreview', {
            recipient: intent.to_user_id, amount: formatAmount(intent.amount_minor), fee: formatAmount(intent.fee_minor),
            total: formatAmount(intent.amount_minor + intent.fee_minor)
        }, { confirm: `积分 转账 确认 ${intent.intent_id} ${intent.confirmation_code}`, cancel: `积分 转账 取消 ${intent.intent_id} ${intent.confirmation_code}` });
    } catch (error) {
        return replyFailure(ctx, systemFailure(error));
    }
};
export const commands = {
    '积分': { description: '积分使用说明', scenes: ['group', 'c2c'] as Array<'group' | 'c2c'>, handler: ({ ctx }: Parameters<CommandHandler>[0]) => replyMessage(ctx, 'help') },
    '积分 开户': { description: '开通本人零余额账户', scenes: ['group', 'c2c'] as Array<'group' | 'c2c'>, handler: openCommand },
    '积分 余额': { description: '查看本人余额', scenes: ['group', 'c2c'] as Array<'group' | 'c2c'>, handler: balanceCommand },
    '积分 流水': { description: '查看本月流水', scenes: ['group', 'c2c'] as Array<'group' | 'c2c'>, handler: transactionsCommand },
    '积分 转账': { description: '向已有账户转账', scenes: ['group', 'c2c'] as Array<'group' | 'c2c'>, handler: transferCommand }
};
