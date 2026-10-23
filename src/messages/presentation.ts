import { renderTemplate, escapeMarkdown, REPLY_FIELDS } from './replies.js';
import type { ReplyKey } from './replies.js';
import type { ReplyConfiguration, ReplyButton } from './reply-config.js';

// 同一组纯函数供发送、校验和浏览器预览使用，不保存业务数据或配置。
export function createReplyPresentation(render: typeof renderTemplate, escape: typeof escapeMarkdown, fields: typeof REPLY_FIELDS) {
    const historyLimit = 10, maxBytes = 16000, defaultSeparator = '\n\n';
    type Values = Record<string, string>;
    type Marks = { key: ReplyKey; start: string; end: string };

    function text(config: ReplyConfiguration, key: ReplyKey, values: Values = {}, raw: string[] = []): string {
        return render(config.replies[key], Object.fromEntries(fields[key].variables.filter(name => Object.hasOwn(values, name)).map(name => [name, raw.includes(name) ? values[name]! : escape(values[name]!)])));
    }

    function history(config: ReplyConfiguration, records: Values[], marks?: Marks): string {
        const key = records.length ? 'historyItem' : 'historyEmpty';
        const piece = (values: Values) => {
            const value = text(config, key, values);

            return marks?.key === key ? marks.start + value + marks.end : value;
        };

        return records.length ? records.map(piece).join(config.historySeparator ?? defaultSeparator) : piece({});
    }

    function buttons(config: ReplyConfiguration, key: string, dynamic: Partial<Record<'confirm' | 'cancel' | 'next', string>>): ReplyButton[][] {
        return (config.buttons[key as keyof typeof config.buttons] ?? []).map(row => row.filter(item => !['confirm', 'cancel', 'next'].includes(item.action) || !!dynamic[item.action as keyof typeof dynamic])).filter(row => row.length);
    }

    function scenarios(config: ReplyConfiguration, key: ReplyKey): string[][] {
        const parent = key === 'historyItem' || key === 'historyEmpty' ? 'history' : key;
        const used = new Set([...config.replies[parent].matchAll(/\{\{([^{}]*)\}\}/g)].map(match => match[1]));

        if (parent === 'balance' && used.has('status')) { return [['normal', '正常账户'], ['paused', '暂停支出']]; }

        if (parent === 'history') {
            if (key === 'historyEmpty') { return [['empty', '暂无流水']]; }

            const pagination = config.buttons.history.some(row => row.some(item => item.action === 'next'));
            const choices = pagination ? [['normal', '有后续页'], ['last', '末页']] : [['normal', '有流水']];

            if (key === 'history' && used.has('items')) { choices.push(['empty', '暂无流水']); }

            return choices;
        }

        if (parent === 'transferPreview' && (used.has('fee') || used.has('total'))) { return [['normal', '免费转账'], ['fee', '含手续费']]; }

        return [['normal', '示例']];
    }

    function sample(config: ReplyConfiguration, key: ReplyKey, scenario: string, marks?: Marks) {
        const parent = key === 'historyItem' || key === 'historyEmpty' ? 'history' : key;
        const values: Values = { userId: '12345678', available: '128.50', reserved: '20.00', total: '148.50', status: scenario === 'paused' ? '暂停主动支出' : '正常', month: '2026-10', time: '2026-10-19 12:30', type: 'mint', reason: '每日签到奖励', transactionId: 'demo-transaction', source: 'daily', referenceId: 'demo-activity', recipient: '87654321', amount: '10.00', fee: scenario === 'fee' ? '0.50' : '0.00', code: 'ACCOUNT_NOT_FOUND', message: '尚未开户，请本人私聊发送 /积分 开户' };

        if (parent === 'transferPreview') { values.total = scenario === 'fee' ? '10.50' : '10.00'; }

        const records = [
            { ...values, available: '+1.00', reserved: '0.00' },
            { ...values, time: '2026-10-19 12:00', type: 'burn', available: '-2.00', reserved: '0.00', reason: '活动消费', transactionId: 'demo-transaction-2', referenceId: 'demo-activity-2' }
        ];
        values.items = history(config, scenario === 'empty' ? [] : records, marks);
        const dynamic = parent === 'history' && scenario === 'normal' ? { next: '积分 流水 demo-cursor' }
            : parent === 'transferPreview' ? { confirm: '积分 转账 确认 demo-intent demo-code', cancel: '积分 转账 取消 demo-intent demo-code' } : {};

        return { text: text(config, parent, values, ['items']), buttons: buttons(config, parent, dynamic), parent, records, values, dynamic };
    }

    function budget(config: ReplyConfiguration, selected?: ReplyKey): { field: ReplyKey; message: string } | null {
        // 以实际十条流水上限和合法字段的保守长度展开；实际发送另核对真实正文。
        const values = Object.fromEntries(Object.values(fields).flatMap(field => field.variables).map(name => [name,
            ['available', 'reserved', 'total', 'amount', 'fee'].includes(name) ? '9'.repeat(32)
                : name === 'month' ? '-'.repeat(7) : ['time', 'type', 'code'].includes(name) ? 'x'.repeat(64)
                    : '界'.repeat(name === 'reason' || name === 'message' ? 256 : name === 'status' ? 16 : 128)]));
        const parent = selected === 'historyItem' || selected === 'historyEmpty' ? 'history' : selected;

        for (const key of Object.keys(config.buttons) as Array<keyof typeof config.buttons>) {
            if (parent && key !== parent) { continue; }

            // 按预算输入区分正文；按钮不同但正文相同的情景只展开一次。
            const variants = key === 'history' ? [...new Set(scenarios(config, key).map(scenario => scenario[0] === 'empty'))] : [false];

            for (const empty of variants) {
                const data = key === 'history' ? { ...values, items: history(config, empty ? [] : Array.from({ length: historyLimit }, () => values)) } : values;
                const content = text(config, key, data, ['items']);

                if (new TextEncoder().encode(content).length > maxBytes) {
                    return { field: key, message: '完整“' + fields[key].title + '”展开后超过 ' + maxBytes + ' 字节；流水按最多 ' + historyLimit + ' 条计入正文、转义和项目间隔' };
                }
            }
        }

        return null;
    }

    return { historyLimit, maxBytes, defaultSeparator, text, history, buttons, scenarios, sample, budget };
}

export const replyPresentation = createReplyPresentation(renderTemplate, escapeMarkdown, REPLY_FIELDS);
