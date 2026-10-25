import { REPLY_FIELDS } from './replies.js';
import type { PluginContext } from '@qqbot/sdk';
import { DEFAULT_CONFIGURATION, MESSAGE_KEYS, configurationError } from './reply-config.js';
import type { ReplyConfiguration, ConfigurationError } from './reply-config.js';
import { requireCondition, systemFailure } from '../wallet/errors.js';
import { pick } from '../wallet/input.js';
import { statement } from '../wallet/storage/sql.js';

export const REPLY_FORMAT = 'points.reply-markdown/v1';
export interface ReplySettings extends ReplyConfiguration { revision: number; }
export class ReplyValidationError extends Error {
    constructor(readonly detail: ConfigurationError) { super(detail.message); }
}

export function validateConfiguration(value: unknown): ReplyConfiguration {
    const error = configurationError(value);

    if (error) { throw new ReplyValidationError(error); }

    // 固定字段顺序，避免对象键顺序造成无意义写入。
    const config = value as ReplyConfiguration;

    return {
        ...(config.historySeparator !== undefined ? { historySeparator: config.historySeparator } : {}),
        replies: Object.fromEntries(Object.keys(REPLY_FIELDS).map(key => [key, config.replies[key as keyof typeof config.replies]])) as ReplyConfiguration['replies'],
        buttons: Object.fromEntries(MESSAGE_KEYS.map(key => [key, config.buttons[key].map(row => row.map(item => ({
            action: item.action, label: item.label, ...(item.data !== undefined ? { data: item.data } : {}), ...(item.enter !== undefined ? { enter: item.enter } : {})
        })))])) as ReplyConfiguration['buttons']
    };
}

export async function loadReplySettings(ctx: Pick<PluginContext, 'db' | 'botId'>): Promise<ReplySettings> {
    const read = () => ctx.db.first<{ revision: number; format: string; replies_json: string }>(
        'SELECT revision,format,replies_json FROM {reply_settings} WHERE bot_id=?', ctx.botId);
    let row;

    try {
        row = await read();
    } catch (error) {
        if (!(error instanceof Error) || !/no such table: (?:\w+\.)?p_points_reply_settings\b/.test(error.message)) { throw error; }

        // 只初始化独立的非资金配置表，不修改钱包标记，也不在 Service 路径调用。
        await ctx.db.batch([statement(`CREATE TABLE IF NOT EXISTS {reply_settings} (
            bot_id TEXT PRIMARY KEY, format TEXT NOT NULL CHECK(format='${REPLY_FORMAT}'),
            revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
            replies_json TEXT NOT NULL CHECK(json_valid(replies_json))) WITHOUT ROWID`)]);
        row = await read();
    }

    if (!row) { return { revision: 0, ...structuredClone(DEFAULT_CONFIGURATION) }; }

    requireCondition(row.format === REPLY_FORMAT && Number.isSafeInteger(row.revision) && row.revision > 0, 'INTERNAL_ERROR');

    try {
        return { revision: row.revision, ...validateConfiguration(JSON.parse(row.replies_json)) };
    } catch {
        requireCondition(false, 'INTERNAL_ERROR');
    }
}

export async function saveReplySettings(ctx: Pick<PluginContext, 'db' | 'botId'>, input: unknown) {
    try {
        const value = pick(input, ['expectedRevision', 'replies', 'buttons', 'historySeparator']);
        requireCondition(Number.isSafeInteger(value.expectedRevision) && (value.expectedRevision as number) >= 0
            && (value.expectedRevision as number) < Number.MAX_SAFE_INTEGER, 'INVALID_ARGUMENT');
        const { expectedRevision, ...payload } = value;
        const config = validateConfiguration(payload);
        const serialized = JSON.stringify(config);
        const current = await loadReplySettings(ctx);
        const { revision: currentRevision, ...currentConfiguration } = current;

        // 相同配置不写库，也可确认已提交但响应丢失的保存结果。
        if (serialized === JSON.stringify(currentConfiguration)) { return { ok: true as const, data: current }; }

        requireCondition(currentRevision === value.expectedRevision, 'POLICY_VERSION_CONFLICT');
        const write = current.revision === 0
            ? statement(`INSERT INTO {reply_settings}(bot_id,format,revision,replies_json) VALUES(?,?,1,?)
                ON CONFLICT(bot_id) DO NOTHING`, ctx.botId, REPLY_FORMAT, serialized)
            : statement(`UPDATE {reply_settings} SET revision=revision+1,replies_json=?
                WHERE bot_id=? AND format=? AND revision=?`, serialized, ctx.botId, REPLY_FORMAT, current.revision);
        const result = await ctx.db.batch([write]);

        if (result[0]!.changes === 1) { return { ok: true as const, data: { revision: current.revision + 1, ...config } }; }

        const winner = await loadReplySettings(ctx);
        const { revision: winnerRevision, ...winnerConfiguration } = winner;
        requireCondition(winnerRevision > 0 && JSON.stringify(winnerConfiguration) === serialized, 'POLICY_VERSION_CONFLICT');

        return { ok: true as const, data: winner };
    } catch (error) {
        if (error instanceof ReplyValidationError) {
            return { ok: false as const, code: 'INVALID_ARGUMENT' as const, retryable: false, ...error.detail };
        }

        const result = systemFailure(error);

        return result.retryable ? { ...result, message: '模板保存结果尚未确认，请原样重试或重新加载核对' } : result;
    }
}
