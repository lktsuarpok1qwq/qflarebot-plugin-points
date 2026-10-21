// 账户查询与 QQ 号绑定复用现有 SID 账户和个人流水入口。
export const QQ_BINDING_HTML = String.raw`<section aria-labelledby="qq-query-title" class="management-block"><h3 id="qq-query-title">按 QQ 号查询</h3>
<p class="hint">QQ 号需由管理员先绑定到已开户 SID；查询结果可直接查看账户或流水。</p>
<div class="account-query"><label>QQ 号<input id="binding-qq" class="qb-input identifier" inputmode="numeric" maxlength="128"></label><button id="binding-find" class="qb-btn">查询绑定</button></div>
<div id="binding-result"><p class="hint">尚未查询，请输入 QQ 号后查询</p></div>
<details id="qq-binding-panel"><summary>QQ 号绑定管理</summary><p class="hint">人工确认上方 QQ 号与 SID 的对应关系；一对一绑定，冲突时先解绑，不自动覆盖。</p>
<div class="account-query"><label>绑定到已有账户 SID<input id="binding-user" class="qb-input identifier" maxlength="128"></label><button id="binding-save" class="qb-btn qb-btn--primary">绑定 QQ 号</button></div>
<div class="actions"><button id="binding-unbind" class="qb-btn qb-btn--danger" disabled>解绑当前查询结果</button></div>
<p class="hint">绑定和解绑独立确认，无需填写资金管理原因；只管理对应关系，不开户、不修改积分或流水，也不校验 QQ 号的实际持有人。</p></details></section>`;
export const ACCOUNT_SCRIPT = String.raw`
let accountReading = false, bindingBusy = false, bindingKnown;

async function openAccountHistory(user) {
    if (historyReading) { throw Error('流水正在查询，请稍后再查看此账户'); }

    fillFields({ 'history-user': user, 'history-source': '', month: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7) });
    showTab(tabs.find(tab => tab.dataset.tab === 'history'));
    await loadHistory();
}

async function loadAccount(userId) {
    if (accountReading) { throw Error('账户正在查询，请稍后再查看'); }

    const user = userId || identifierField('user', '请填写账户 SID');
    accountReading = true;
    $('account-load').disabled = true;

    if (userId) { fillFields({ user }); }

    clearDetail();

    try {
        await readView('account', { user }, a => table('account-result', [['SID', r => r.user_id], ['可用', r => money(r.available_minor)], ['冻结', r => money(r.reserved_minor)], ['状态', r => r.status === 'active' ? '正常' : '暂停支出']], a ? [a] : [], (r, td) => rowButton(td, '查看流水', () => openAccountHistory(r.user_id)), '此账户尚未开户，请本人私聊机器人发送 /积分 开户'), ['user'], 'account-result');
    } finally {
        accountReading = false;
        $('account-load').disabled = false;
    }
}

function invalidateAccount(message = '账户信息可能已变化，请重新查询', affectedUsers) {
    if (affectedUsers && !affectedUsers.includes(val('user'))) { return; }

    readVersions.set('account', (readVersions.get('account') || 0) + 1);
    $('account-result').removeAttribute('aria-busy');
    $('account-result').textContent = message;
}

function showAdjustmentTarget() {
    $('adjustment-target').textContent = val('user') ? '当前操作账户 SID：' + val('user') : '请先填写 SID，或从 QQ 查询结果点击“查看账户”带入 SID';
}

$('user').addEventListener('input', () => {
    showAdjustmentTarget();
    invalidateAccount('账户 SID 已修改，请重新查询');
});
showAdjustmentTarget();
on('account-load', () => loadAccount());

function bindingQqField() {
    const qq = identifierField('binding-qq', '请填写 QQ 号');

    if (!/^[1-9][0-9]*$/.test(qq)) { fieldError('binding-qq', 'QQ 号应为非零开头的纯数字'); }

    return qq;
}

function validBinding(row, qq) {
    return row && row.qqNumber === qq && typeof row.userId === 'string' && row.userId.length > 0
        && row.userId.length <= UI_LIMITS.idCharacters && !/[\s\x00-\x1f\x7f]/u.test(row.userId);
}

function syncBindingControls() {
    $('binding-find').disabled = bindingBusy;
    $('binding-unbind').disabled = bindingBusy || !bindingKnown;
    $('binding-save').disabled = bindingBusy || (bindingKnown?.qqNumber === val('binding-qq') && bindingKnown.userId === val('binding-user'));
}

function showBinding(row) {
    bindingKnown = row;
    table('binding-result', [['QQ 号', r => r.qqNumber], ['SID', r => r.userId]], row ? [row] : [], (r, td) => {
        const actions = document.createElement('div');
        actions.className = 'actions';
        td.append(actions);
        rowButton(actions, '查看账户', () => loadAccount(r.userId));
        rowButton(actions, '查看流水', () => openAccountHistory(r.userId));
    }, '此 QQ 号尚未绑定，请填写已开户 SID 后绑定');
    syncBindingControls();
}

function invalidateBinding(message) {
    bindingKnown = undefined;
    readVersions.set('qq-binding', (readVersions.get('qq-binding') || 0) + 1);
    $('binding-result').removeAttribute('aria-busy');
    $('binding-result').textContent = message;
    syncBindingControls();
}

$('binding-qq').addEventListener('input', () => invalidateBinding('QQ 号已修改，请重新查询'));
$('binding-user').addEventListener('input', syncBindingControls);

on('binding-find', async () => {
    if (bindingBusy) { return; }

    const qq = bindingQqField();
    bindingKnown = undefined;
    bindingBusy = true;
    syncBindingControls();

    try {
        await readView('qq-binding', { qq }, row => {
            if (row !== null && !validBinding(row, qq)) { throw Error('绑定查询响应不符合要求，请重新查询'); }

            showBinding(row);
        }, ['binding-qq'], 'binding-result');
    } finally {
        bindingBusy = false;
        syncBindingControls();
    }
});

async function writeBinding(action, row) {
    if (bindingBusy) { return; }

    const input = row || { qqNumber: bindingQqField(), userId: identifierField('binding-user', '请填写已开户账户 SID') };
    const removing = action === 'qq-unbind';
    const current = readContext('qq-binding', removing ? ['binding-qq'] : ['binding-qq', 'binding-user']);
    let submitted = false;
    bindingBusy = true;
    syncBindingControls();

    try {
        const accepted = await confirm((removing ? '解绑' : '绑定') + ' QQ 号 ' + input.qqNumber + '\n账户 SID：' + input.userId
            + '\n只修改对应关系，账户、积分和流水保持不动', { title: removing ? '解绑 QQ 号' : '绑定 QQ 号', accept: removing ? '确认解绑' : '确认绑定', danger: removing });

        if (!accepted || !current()) { return; }

        submitted = true;
        const result = await post({ action, confirmed: true, ...input });

        if (!result.ok) { throw Error(result.message); }

        if (!validBinding(result.data, input.qqNumber) || result.data.userId !== input.userId || result.data.bound !== !removing) {
            throw Error('绑定操作结果尚未确认，请查询对应 QQ 号或原样重试');
        }

        if (current()) {
            showBinding(removing ? null : result.data);
            notice(removing ? 'QQ 号已解绑' : 'QQ 号已绑定');
        } else if (val('binding-qq') === input.qqNumber) {
            invalidateBinding('绑定状态可能已变化，请重新查询');
        }
    } catch (error) {
        const applicable = current();

        if (submitted && val('binding-qq') === input.qqNumber) { invalidateBinding('绑定状态需重新查询，输入已保留'); }

        if (applicable) { notice(error.message || String(error), true); }
    } finally {
        bindingBusy = false;
        syncBindingControls();
    }
}

on('binding-save', () => writeBinding('qq-bind'));
on('binding-unbind', () => bindingKnown && writeBinding('qq-unbind', bindingKnown));
syncBindingControls();
`;
