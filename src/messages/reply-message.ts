import { button, keyboard } from '@qqbot/sdk';
import type { OutgoingMessage, PluginContext } from '@qqbot/sdk';
import type { PointsFailure } from '../contracts.js';
import { DEFAULT_CONFIGURATION } from './reply-config.js';
import type { MessageKey, ReplyConfiguration } from './reply-config.js';
import { reply, escapeMarkdown } from './replies.js';

export function configuration(ctx: Pick<PluginContext, 'config'>): ReplyConfiguration {
    // 入口先完整校验 D1 配置；直接调用处理器的测试上下文使用当前默认配置。
    return ((ctx.config as { replyConfiguration?: ReplyConfiguration })?.replyConfiguration) ?? DEFAULT_CONFIGURATION;
}

export function replyMessage(ctx: Pick<PluginContext, 'config'>, key: MessageKey, values: Record<string, string> = {}, dynamic: Partial<Record<'confirm' | 'cancel' | 'next', string>> = {}, rawValues: string[] = []): OutgoingMessage {
    const config = configuration(ctx);
    const text = reply(ctx, key, Object.fromEntries(Object.entries(values).map(([name, value]) => [name, !rawValues.includes(name) ? escapeMarkdown(value) : value])));
    const commands = { help: '积分', open: '积分 开户', balance: '积分 余额', history: '积分 流水', transfer: '积分 转账 ' };
    const rows = config.buttons[key].map(row => row.flatMap(item => {
        if (item.action === 'confirm' || item.action === 'cancel' || item.action === 'next') {
            const data = dynamic[item.action];

            return data ? [button.command(item.label, data, { enter: true, visitedLabel: item.label })] : [];
        }

        if (item.action === 'link') { return [button.link(item.label, item.data!, { visitedLabel: item.label })]; }

        return [button.command(item.label, item.action === 'command' ? item.data! : commands[item.action], { enter: item.action === 'transfer' ? false : item.enter, visitedLabel: item.label })];
    })).filter(row => row.length);

    return { text, markdown: { content: text }, ...(rows.length ? { keyboard: keyboard(rows) } : {}) };
}

export function replyFailure(ctx: Pick<PluginContext, 'config'>, error: PointsFailure): OutgoingMessage {
    return replyMessage(ctx, 'error', { code: error.code, message: error.message });
}
