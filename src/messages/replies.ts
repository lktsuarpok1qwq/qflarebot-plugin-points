import type { PluginContext } from '@qqbot/sdk';

export const REPLY_FIELDS = {
    help: { title: '积分帮助', text: '积分', variables: [] },
    privateOnly: { title: '私聊操作提示', text: '请私聊机器人操作积分', variables: [] },
    openUsage: { title: '开户参数错误', text: '开户无需填写参数', variables: [] },
    opened: { title: '开户成功', text: '账户已开通\nSID：{{userId}}', variables: ['userId'] },
    balance: { title: '本人余额', text: '可用 {{available}}\n冻结 {{reserved}}\n总额 {{total}}\n状态：{{status}}', variables: ['userId', 'available', 'reserved', 'total', 'status'] },
    history: { title: '流水列表', text: '{{month}} 流水\n{{items}}', variables: ['userId', 'month', 'items'] },
    historyItem: { title: '单笔流水片段', text: '{{time}} {{type}}\n可用变动 {{available}} / 冻结变动 {{reserved}}\n{{reason}}', variables: ['time', 'type', 'available', 'reserved', 'reason', 'transactionId', 'source', 'referenceId'], variableHelp: { available: '本笔交易的可用积分净变动，含手续费；正数增加、负数减少', reserved: '本笔交易的冻结积分净变动；正数增加、负数减少' } },
    historyEmpty: { title: '暂无流水片段', text: '暂无记录', variables: [] },
    transferUsage: { title: '转账参数提示', text: '请填写收款 SID 和金额', variables: [] },
    transferPreview: { title: '转账待确认', text: '收款：{{recipient}}\n到账：{{amount}}\n手续费（销毁）：{{fee}}\n扣款：{{total}}\n尚未扣款，请在首次请求后5分钟内确认', variables: ['recipient', 'amount', 'fee', 'total'], required: ['recipient', 'amount', 'fee', 'total'], variableHelp: { total: '付款人本次扣款总额：到账积分＋手续费' } },
    transferCompleted: { title: '转账完成', text: '转账成功\n交易号：{{transactionId}}', variables: ['transactionId'] },
    error: { title: '操作失败或取消', text: '{{message}}', variables: ['code', 'message'] }
};
// 编辑器的变量说明；同名变量的业务含义由所在模板补充。
export const REPLY_VARIABLE_HELP: Record<string, string> = {
    userId: '本人积分账户的 SID', available: '当前可用积分', reserved: '当前冻结积分', total: '可用与冻结积分之和',
    status: '账户状态：正常或暂停主动支出', month: '本次查询的北京月份', items: '由有流水或无流水时的正文片段生成的列表内容',
    time: '本笔交易发生的北京时间', type: '交易类型标识，如 mint（发行）、burn（销毁）',
    reason: '操作原因；未填写时显示业务关联或交易编号', transactionId: '本笔交易的编号', source: '发起交易的来源标识',
    referenceId: '本笔交易的业务关联编号；未填写时为空', recipient: '收款账户的 SID', amount: '收款人实际到账的积分',
    fee: '本次销毁的手续费积分', code: '操作结果代码', message: '本次操作的提示内容'
};
// 流水片段的使用方同时驱动编辑说明和完整消息预览，不进入持久化配置。
export const REPLY_FRAGMENTS = {
    historyItem: { message: 'history', variable: 'items', empty: false },
    historyEmpty: { message: 'history', variable: 'items', empty: true }
} as const;
export type ReplyKey = keyof typeof REPLY_FIELDS;
export type Replies = Record<ReplyKey, string>;
export const DEFAULT_REPLIES = Object.fromEntries(Object.entries(REPLY_FIELDS).map(([key, value]) => [key, value.text])) as Replies;
export const REPLY_GROUPS: Record<ReplyKey, string> = {
    help: '/积分', openUsage: '/积分 开户', opened: '/积分 开户', balance: '/积分 余额',
    history: '/积分 流水 [游标]', historyItem: '/积分 流水 [游标]', historyEmpty: '/积分 流水 [游标]',
    transferUsage: '/积分 转账 <SID> <金额>', transferPreview: '/积分 转账 <SID> <金额>', transferCompleted: '/积分 转账 <SID> <金额>', privateOnly: '通用提示', error: '通用提示'
};

// 与编辑器共用检查逻辑，位置使用 UTF-16 下标，可直接定位文本框选区。
export function templateError(value: unknown, variables: readonly string[], required: readonly string[] = []): { message: string; start: number; end: number } | null {
    if (typeof value !== 'string' || !value.trim()) { return { message: '模板不能为空', start: 0, end: 0 }; }

    const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.exec(value);

    if (control) { return { message: '模板包含不支持的控制字符', start: control.index, end: control.index + 1 }; }

    const keys = new Set<string>();
    let end = 0;

    for (const match of value.matchAll(/\{\{([^{}]*)\}\}/g)) {
        const malformed = /\{\{|\}\}/.exec(value.slice(end, match.index));

        if (malformed) { return { message: '变量格式应为 {{变量名}}', start: end + malformed.index, end: end + malformed.index + 1 }; }

        if (value[match.index - 1] === '{' || value[match.index + match[0].length] === '}') {
            return { message: '变量格式应为 {{变量名}}', start: Math.max(0, match.index - 1), end: match.index + match[0].length + 1 };
        }

        const key = match[1]!;

        if (!variables.includes(key)) { return { message: '未知变量：' + key, start: match.index, end: match.index + match[0].length }; }

        keys.add(key);
        end = match.index + match[0].length;
    }

    const malformed = /\{\{|\}\}/.exec(value.slice(end));

    if (malformed) { return { message: '变量格式应为 {{变量名}}', start: end + malformed.index, end: end + malformed.index + 1 }; }

    const missing = required.find(key => !keys.has(key));

    return missing ? { message: '必须保留变量：{{' + missing + '}}', start: value.length, end: value.length } : null;
}

export function renderTemplate(template: string, values: Record<string, string>): string {
    // 一次替换，不将变量内容当作另一层模板或脚本执行。
    return template.replace(/\{\{([^{}]*)\}\}/g, (_, name: string) => values[name] ?? '{{' + name + '}}');
}

export function reply(ctx: Pick<PluginContext, 'config'>, key: ReplyKey, values: Record<string, string> = {}): string {
    const config = ctx.config as { replies?: Partial<Record<ReplyKey, unknown>> };
    const field = REPLY_FIELDS[key];
    const candidate = config?.replies?.[key];
    const valid = !templateError(candidate, field.variables, 'required' in field ? field.required : []);

    return renderTemplate(valid ? candidate as string : field.text, values);
}

export function escapeMarkdown(value: string): string {
    return value.replace(/[\\`*_{}\[\]()<>#+.!|~\-]/g, '\\$&');
}
