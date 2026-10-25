import { DEFAULT_REPLIES, REPLY_FIELDS, templateError } from './replies.js';
import type { Replies, ReplyKey } from './replies.js';
import { replyPresentation } from './presentation.js';

export const MESSAGE_KEYS = ['help', 'privateOnly', 'openUsage', 'opened', 'balance', 'history', 'transferUsage', 'transferPreview', 'transferCompleted', 'error'] as const;
export type MessageKey = typeof MESSAGE_KEYS[number];
export const BUTTON_ACTIONS = {
    help: '积分帮助', open: '本人开户', balance: '本人余额', history: '本人流水', transfer: '填写转账命令',
    command: '自定义命令', link: '打开链接', confirm: '确认本次转账', cancel: '取消本次转账', next: '下一页流水'
};
export type ButtonAction = keyof typeof BUTTON_ACTIONS;
export const BUTTON_ACTION_HELP: Record<ButtonAction, string> = {
    help: '打开积分帮助；点击方式可选择直接发送或填入输入框',
    open: '仅开通点击者本人的账户，不为其他用户代开',
    balance: '查询点击者本人的余额', history: '查询点击者本人的流水',
    transfer: '仅填入转账命令，由本人填写收款 SID 和金额后发送',
    command: '发送或填入固定命令文字，不替换模板变量', link: '打开填写的 HTTP 或 HTTPS 地址',
    confirm: '转账确认必须保留一个；功能和删除锁定，确认凭据由程序生成',
    cancel: '转账取消必须保留一个；功能和删除锁定，确认凭据由程序生成',
    next: '流水翻页必须保留一个；仅有后续页时显示，游标由程序生成'
};
export interface ReplyButton {
    action: ButtonAction;
    label: string;
    data?: string;
    enter?: boolean;
}
export interface ReplyConfiguration {
    replies: Replies;
    buttons: Record<MessageKey, ReplyButton[][]>;
    historySeparator?: string;
}
export const DEFAULT_CONFIGURATION: ReplyConfiguration = {
    replies: DEFAULT_REPLIES,
    buttons: {
        help: [[{ action: 'open', label: '开户', enter: true }, { action: 'balance', label: '查余额', enter: true }, { action: 'history', label: '查流水', enter: true }], [{ action: 'transfer', label: '转账' }]],
        privateOnly: [], openUsage: [[{ action: 'open', label: '开户', enter: true }]],
        opened: [[{ action: 'balance', label: '查余额', enter: true }, { action: 'history', label: '查流水', enter: true }]],
        balance: [[{ action: 'history', label: '查流水', enter: true }, { action: 'transfer', label: '转账' }]],
        history: [[{ action: 'next', label: '下一页' }]], transferUsage: [[{ action: 'transfer', label: '填写转账' }]],
        transferPreview: [[{ action: 'confirm', label: '确认转账' }, { action: 'cancel', label: '取消' }]],
        transferCompleted: [], error: []
    }
};
export interface ConfigurationError {
    field: ReplyKey;
    target: 'text' | 'buttons' | 'historySeparator';
    message: string;
    row?: number;
    item?: number;
    control?: 'label' | 'action' | 'data' | 'enter';
    start: number;
    end: number;
}

// 依赖显式传入，同一校验工厂供服务端和浏览器使用，不依赖宿主打包后的外部变量名。
export function createConfigurationValidator(fields: typeof REPLY_FIELDS, messageKeys: readonly MessageKey[], actionsByName: typeof BUTTON_ACTIONS,
    validateTemplate: typeof templateError, validateUrl: typeof safeHttpUrl, presentation: Pick<typeof replyPresentation, 'budget'>) {
    // 只接收明确的配置结构，不接受脚本或动态凭据。
    return function configurationError(value: unknown, selected?: ReplyKey): ConfigurationError | null {
        const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
        const exact = (v: unknown, keys: readonly string[]) => object(v) && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
        const problem = (field: ReplyKey, target: ConfigurationError['target'], message: string): ConfigurationError => ({ field, target, message, start: 0, end: 0 });

        if (!exact(value, object(value) && Object.hasOwn(value, 'historySeparator') ? ['replies', 'buttons', 'historySeparator'] : ['replies', 'buttons'])) { return problem('help', 'text', '模板配置结构不符合要求'); }

        const config = value as unknown as ReplyConfiguration;

        if (Object.hasOwn(config, 'historySeparator') && (typeof config.historySeparator !== 'string'
            || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(config.historySeparator)
            || new TextEncoder().encode(config.historySeparator).length > 4096)) {
            return problem('history', 'historySeparator', '项目间隔最多4096字节，不接受不支持的控制字符；留空表示直接连接');
        }

        if (!exact(config.replies, Object.keys(fields)) || !exact(config.buttons, messageKeys)) {
            return problem('help', 'text', '请提交全部正文和按钮配置');
        }

        for (const key of (Object.keys(fields) as ReplyKey[]).filter(key => selected === undefined || key === selected)) {
            const field = fields[key];
            const error = validateTemplate(config.replies[key], field.variables, 'required' in field ? field.required : []);

            if (error) { return { ...error, field: key, target: 'text' }; }
        }

        for (const key of messageKeys.filter(key => selected === undefined || key === selected)) {
            const rows = config.buttons[key];

            if (!Array.isArray(rows) || rows.length > 5 || rows.some(row => !Array.isArray(row) || row.length < 1 || row.length > 5)) {
                return problem(key, 'buttons', '按钮最多 5 行，每行 1～5 个；不使用按钮时删除全部行');
            }

            const actions: string[] = [];

            for (const [rowIndex, row] of rows.entries()) {
                for (const [itemIndex, item] of row.entries()) {
                    const buttonProblem = (message: string, control: ConfigurationError['control']): ConfigurationError => ({
                        ...problem(key, 'buttons', message), row: rowIndex, item: itemIndex, control
                    });

                    if (!object(item) || Object.keys(item).some(name => !['action', 'label', 'data', 'enter'].includes(name))
                        || !Object.hasOwn(actionsByName, item.action) || typeof item.label !== 'string' || !item.label.trim()
                        || [...item.label].length > 10 || /[\r\n\u0000-\u001f]/.test(item.label)) {
                        return buttonProblem('按钮需要已知功能和 1～10 字的单行文字', object(item) && Object.hasOwn(actionsByName, item.action) ? 'label' : 'action');
                    }

                    const dynamic = ['confirm', 'cancel', 'next'].includes(item.action);

                    if (dynamic) {
                        if ((item.action === 'next' ? key !== 'history' : key !== 'transferPreview') || item.data !== undefined || item.enter !== undefined) {
                            return buttonProblem('动态按钮仅用于对应的转账确认或流水列表，参数由程序生成', 'action');
                        }
                    } else if (item.action === 'link') {
                        if (!validateUrl(item.data) || item.enter !== undefined) { return buttonProblem('链接按钮请填写有效的 HTTP 或 HTTPS 地址', 'data'); }
                    } else {
                        if (item.action === 'command') {
                            if (typeof item.data !== 'string' || !item.data.trim() || /[\u0000-\u001f{}]/.test(item.data)) {
                                return buttonProblem('自定义命令须为单行文字，不接受变量或控制字符', 'data');
                            }
                        } else if (item.data !== undefined) { return buttonProblem('内置按钮不接受自定义参数', 'action'); }

                        if (item.action === 'transfer' ? item.enter !== undefined : typeof item.enter !== 'boolean') {
                            return buttonProblem('请选择直接发送或填入输入框；转账入口只填入命令', 'enter');
                        }
                    }

                    actions.push(item.action);
                }
            }

            for (const action of key === 'transferPreview' ? ['confirm', 'cancel'] : key === 'history' ? ['next'] : []) {
                if (actions.filter(name => name === action).length !== 1) {
                    return problem(key, 'buttons', '必须保留且仅保留一个“' + actionsByName[action as ButtonAction] + '”按钮');
                }
            }
        }

        const expanded = presentation.budget(config, selected);

        return expanded ? problem(expanded.field, 'text', expanded.message) : null;
    };
}

export const configurationError = createConfigurationValidator(REPLY_FIELDS, MESSAGE_KEYS, BUTTON_ACTIONS, templateError, safeHttpUrl, replyPresentation);

export function safeHttpUrl(value: unknown): value is string {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || /[\s<>"'\u0000-\u001f]/.test(value)) { return false; }

    try {
        const url = new URL(value);

        return !!url.hostname && !url.username && !url.password;
    } catch { return false; }
}
