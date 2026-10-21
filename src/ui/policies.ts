// 政策表单各自保存基线与浏览器草稿；服务端继续负责版本、权限和幂等。
export const POLICY_EDITOR_SCRIPT = String.raw`
const permissionNames = { burn: '销毁', transfer: '转账', reserve: '本金冻结', renew: '本金续期', release: '本金释放', settle: '结算', reverseOwn: '本来源完整冲正' };
let sourceBaseline, sourceVersion = null, sourceRows, wallet, walletBaseline, sourceReading = false, walletReading = false;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sourceDraft = () => ({
    source: val('source-id'), enabled: $('source-enabled').checked,
    operationPermissions: [...$('permissions').querySelectorAll('input:checked')].map(input => input.dataset.permission).sort(),
    readPermissions: [$('read-balance').checked ? 'balance' : null, $('read-transactions').checked ? 'transactions' : null].filter(Boolean).sort()
});
const walletDraft = () => ({ enabled: $('wallet-enabled').checked, feeMode: val('fee-mode'), rate: val('fee-rate') });
const sourceDirty = () => !same(sourceDraft(), sourceBaseline);

function parseFeeRate(text) {
    if (!/^\d{1,8}(\.\d{1,6})?$/.test(text)) { return null; }

    const [whole, decimal = ''] = text.split('.');

    return { numerator: Number(whole + decimal), denominator: 100 * 10 ** decimal.length };
}

function sameFeeRate(rate) {
    if (rate === walletBaseline.rate) { return true; }

    const parsed = parseFeeRate(rate);

    return !!parsed && BigInt(parsed.numerator) * BigInt(wallet.qq_fee_denominator) === BigInt(wallet.qq_fee_numerator) * BigInt(parsed.denominator);
}

const walletDirty = () => {
    if (!walletBaseline) { return false; }

    const draft = walletDraft();

    return draft.enabled !== walletBaseline.enabled || draft.feeMode !== walletBaseline.feeMode
        || (draft.feeMode === 'proportional' && !sameFeeRate(draft.rate));
};

const disablePolicyButton = (id, disabled) => { $(id).disabled = disabled || $(id).getAttribute('aria-busy') === 'true'; };

function syncPolicyEditors() {
    document.querySelector('[data-reason-slot=wallet]').hidden = !walletBaseline;
    syncReason();
    const sourceLocked = pending?.action === 'source-policy', walletLocked = pending?.action === 'wallet-policy';
    $('source-status').textContent = (sourceBaseline?.source ? '当前编辑来源：' + sourceBaseline.source : '当前为新来源') + (sourceDirty() ? ' · 有未保存的修改' : ' · 暂无未保存修改');
    disablePolicyButton('source-save', sourceReading || sourceLocked || !sourceDirty());
    disablePolicyButton('source-discard', sourceReading || sourceLocked || !sourceDirty());
    disablePolicyButton('source-new', sourceReading || sourceLocked);
    disablePolicyButton('source-load', sourceReading || sourceLocked);

    for (const button of $('source-list').querySelectorAll('button')) { button.disabled = sourceReading || sourceLocked || button.getAttribute('aria-busy') === 'true'; }

    if (val('fee-mode') === 'free') { clearFieldError($('fee-rate')); }

    $('wallet-status').textContent = walletReading ? '正在加载…' : !walletBaseline ? '尚未加载' : walletDirty() ? '有未保存的修改' : '暂无未保存修改';
    $('wallet-status').setAttribute('aria-busy', String(walletReading));
    $('wallet-load').textContent = walletBaseline ? '重新加载' : '加载设置';
    disablePolicyButton('wallet-load', walletReading || walletLocked);
    disablePolicyButton('wallet-save', walletReading || walletLocked || !walletDirty());
    disablePolicyButton('wallet-discard', walletReading || walletLocked || !walletDirty());

    for (const id of ['wallet-enabled', 'fee-mode', 'fee-rate']) {
        $(id).disabled = walletReading || !walletBaseline || (id === 'fee-rate' && val('fee-mode') === 'free');
    }
}

for (const [key, label] of Object.entries(permissionNames)) {
    const item = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.permission = key;
    item.append(input, document.createTextNode(label));
    $('permissions').append(item);
}

function fillSource(row) {
    sourceVersion = row?.policy_version ?? null;
    const data = row ? { source: row.source, enabled: row.enabled !== 0, operationPermissions: JSON.parse(row.operation_permissions).sort(), readPermissions: JSON.parse(row.read_permissions).sort() }
        : { source: '', enabled: true, operationPermissions: [], readPermissions: [] };
    $('source-id').value = data.source;
    $('source-id').readOnly = !!row;
    $('source-enabled').checked = data.enabled;

    for (const input of $('permissions').querySelectorAll('input')) { input.checked = data.operationPermissions.includes(input.dataset.permission); }

    $('read-balance').checked = data.readPermissions.includes('balance');
    $('read-transactions').checked = data.readPermissions.includes('transactions');
    sourceBaseline = structuredClone(data);

    for (const input of $('source').querySelectorAll('input,select')) { clearFieldError(input); }

    syncPolicyEditors();
}

async function allowDiscard(dirty) {
    return !dirty || await confirm('此操作会丢弃当前未保存的修改，是否继续？', { title: '确认放弃修改', accept: '放弃修改' });
}

function drawSources() {
    table('source-list', [['来源', row => row.source], ['状态', row => row.enabled ? '启用' : '禁用']], sourceRows, (row, cell) => {
        if (!['points.qq', 'points.system'].includes(row.source)) {
            rowButton(cell, '编辑', async () => {
                if (await allowDiscard(sourceDirty())) { fillSource(row); }
            });
        }
    });

    if (sourceRows?.length === 50) { rowButton($('source-list'), '下一页', () => loadSources(sourceRows.at(-1).source), $('source-load')); }
}

on('source-new', async () => {
    if (await allowDiscard(sourceDirty())) { fillSource(null); }
});
on('source-discard', async () => {
    if (await allowDiscard(sourceDirty())) {
        fillSource(sourceBaseline.source ? { source: sourceBaseline.source, enabled: Number(sourceBaseline.enabled), operation_permissions: JSON.stringify(sourceBaseline.operationPermissions), read_permissions: JSON.stringify(sourceBaseline.readPermissions), policy_version: sourceVersion } : null);
    }
});

async function loadSources(after) {
    if (sourceReading) { return; }

    sourceReading = true;
    syncPolicyEditors();

    try {
        await readView('sources', after ? { after } : {}, rows => {
            sourceRows = rows;
            drawSources();
            $('source-load').textContent = '重新加载';
        }, [], 'source-list');
    } catch (error) {
        if (after) { rowButton($('source-list'), '重试下一页', () => loadSources(after), $('source-load')); }

        throw error;
    } finally {
        sourceReading = false;
        syncPolicyEditors();
    }
}

on('source-load', () => loadSources());
on('source-save', async () => {
    const source = required('source-id', '请填写来源标识');

    if (source.length > $('source-id').maxLength || !/^[a-z][a-z0-9._-]*$/.test(source)) {
        fieldError('source-id', '来源须以小写字母开头，仅含小写字母、数字、点、下划线或连字符，最多 128 字符');
    }

    if (['points.qq', 'points.system'].includes(source)) { fieldError('source-id', '此系统来源由积分插件管理'); }

    const policy = sourceDraft(), expectedVersion = sourceVersion, baseline = sourceBaseline;
    const preview = '来源 ' + policy.source + '：' + (policy.enabled ? '启用' : '禁用') + '\n资金权限：' + policy.operationPermissions.map(key => permissionNames[key]).join('、')
        + '\n读取权限：' + policy.readPermissions.map(key => key === 'balance' ? '余额' : '流水').join('、')
        + (policy.enabled ? '\n启用后允许发行积分。' : '')
        + '\n禁用禁止新发行与续期，既有本金仍可结算和释放，不能附带新奖励。';
    await submit({ action: 'source-policy', expectedVersion, policy }, preview, submitted => {
        const row = sourceRows?.find(row => row.source === policy.source);

        if (row && row.policy_version <= (expectedVersion ?? -1) + 1) {
            Object.assign(row, { enabled: Number(policy.enabled), operation_permissions: JSON.stringify(policy.operationPermissions), read_permissions: JSON.stringify(policy.readPermissions), policy_version: (expectedVersion ?? -1) + 1 });
            drawSources();
        } else if (sourceRows && !row) {
            sourceRows = undefined;
            readVersions.set('sources', (readVersions.get('sources') || 0) + 1);
            $('source-list').textContent = '来源列表可能已变化，请点击重新加载查看';
            $('source-load').textContent = '重新加载';
        }

        if (sourceBaseline === baseline && val('source-id') === submitted.policy.source) {
            sourceBaseline = structuredClone(submitted.policy);
            sourceVersion = (submitted.expectedVersion ?? -1) + 1;
            $('source-id').readOnly = true;
            syncPolicyEditors();
        }
    });
});

function fillWallet(row) {
    wallet = row;
    $('wallet-enabled').checked = !!row.qq_transfer_enabled;
    $('fee-mode').value = row.qq_fee_mode;
    $('fee-rate').value = String(row.qq_fee_numerator / row.qq_fee_denominator * 100);
    walletBaseline = walletDraft();
    clearFieldError($('fee-rate'));
    syncPolicyEditors();
}

on('wallet-load', async () => {
    if (!await allowDiscard(walletDirty())) { return; }

    walletReading = true;
    syncPolicyEditors();

    try {
        const displayed = await readView('policy', {}, fillWallet, ['wallet-enabled', 'fee-mode', 'fee-rate']);

        if (displayed) { notice('转账设置已加载'); }
    } finally {
        walletReading = false;
        syncPolicyEditors();
    }
});
on('wallet-discard', async () => {
    if (await allowDiscard(walletDirty())) { fillWallet(wallet); }
});
on('wallet-save', async () => {
    if (!walletDirty()) { return; }

    const draft = walletDraft(), baseline = walletBaseline;
    let numerator = wallet.qq_fee_numerator, denominator = wallet.qq_fee_denominator;

    if (draft.feeMode === 'proportional' && !sameFeeRate(draft.rate)) {
        const parsed = parseFeeRate(draft.rate);

        if (!parsed) { fieldError('fee-rate', '请输入非负百分比，最多六位小数'); }

        numerator = parsed.numerator;
        denominator = parsed.denominator;
    }

    const expectedVersion = wallet.policy_version;
    await submit({ action: 'wallet-policy', expectedVersion, enabled: draft.enabled, feeMode: draft.feeMode, numerator, denominator }, '转账：' + (draft.enabled ? '开启' : '关闭') + '\n手续费：' + (draft.feeMode === 'free' ? '免费' : draft.rate + '%') + '\n不影响 Service 转账；待确认转账保留原费额', submitted => {
        if (walletBaseline !== baseline) { return; }

        wallet = { ...wallet, qq_transfer_enabled: Number(submitted.enabled), qq_fee_mode: submitted.feeMode, qq_fee_numerator: submitted.numerator, qq_fee_denominator: submitted.denominator, policy_version: submitted.expectedVersion + 1 };
        walletBaseline = { enabled: submitted.enabled, feeMode: submitted.feeMode, rate: String(submitted.numerator / submitted.denominator * 100) };
        syncPolicyEditors();
    });
});

for (const id of ['source', 'wallet']) {
    $(id).addEventListener('input', syncPolicyEditors);
    $(id).addEventListener('change', syncPolicyEditors);
}

fillSource(null);
`;
