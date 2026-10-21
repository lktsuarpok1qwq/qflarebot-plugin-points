// 完整消息使用当前草稿和固定样例；来源标记只存在于浏览器，不保存、不发送。
export const PREVIEW_EDITOR_SCRIPT = String.raw`
function paintReplyPreview(config, key, mode, scenario) {
    const fragment = REPLY_FRAGMENTS[key], full = mode === 'sample' && fragment;
    const empty = full ? fragment.empty : scenario === 'empty';
    const messageKey = full ? fragment.message : key, slot = fragment ? fragment.variable : 'items';
    const raw = { userId: '12345678', available: '128.50', reserved: '20.00', total: '148.50', status: scenario === 'paused' ? '暂停主动支出' : '正常', month: '2026-10', time: '2026-10-19 12:30', type: 'mint', reason: '每日签到奖励', transactionId: 'demo-transaction', source: 'daily', referenceId: 'demo-activity', recipient: '87654321', amount: '10.00', fee: scenario === 'fee' ? '0.50' : '0.00', code: 'ACCOUNT_NOT_FOUND', message: '尚未开户，请本人私聊发送 /积分 开户' };

    if (key === 'transferPreview') { raw.total = scenario === 'fee' ? '10.50' : '10.00'; }

    const values = Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, escapeMarkdown(value)]));
    const historyValues = { ...values, available: escapeMarkdown('+1.00'), reserved: '0.00' };
    const token = '\uE000' + crypto.randomUUID();
    const markers = { start: token + 'S\uE001', end: token + 'E\uE001' };
    const selected = empty ? 'historyEmpty' : 'historyItem';
    const piece = renderTemplate(config.replies[selected], historyValues);
    values[slot] = full && selected === key ? markers.start + piece + markers.end : piece;
    const text = mode === 'layout' ? config.replies[key] : renderTemplate(config.replies[messageKey], values);
    const output = $('reply-preview-text');
    output.innerHTML = renderQQMarkdown(text, full ? markers : undefined);
    const marked = !!output.querySelector('mark,.sample-highlight');
    restoreReplyImages();
    $('reply-preview-notice').textContent = mode === 'layout' ? '变量保持原样 · 当前正文' : full
        ? !config.replies[key].trim() ? '当前片段为空' : marked ? '虚构数据 · 高亮部分为当前编辑片段' : text.includes(markers.start) ? '当前片段没有可显示的内容' : '流水列表草稿未引用 {{' + slot + '}}，当前片段未出现在消息中'
        : '虚构数据 · 使用当前正文与消息按钮草稿，不发送消息';
    $('reply-preview-title').textContent = '即时预览 · ' + (MESSAGE_KEYS.includes(key) || full ? '完整消息' : '当前片段');
    $('reply-preview-buttons').replaceChildren();

    for (const row of config.buttons[messageKey] || []) {
        const line = document.createElement('div');
        line.className = 'actions';

        for (const item of row) {
            if (item.action === 'next' && (empty || scenario !== 'normal')) { continue; }

            const button = document.createElement('button');
            button.className = 'qb-btn';
            button.textContent = item.label;
            button.disabled = true;
            line.append(button);
        }

        if (line.children.length) { $('reply-preview-buttons').append(line); }
    }
}
`;
