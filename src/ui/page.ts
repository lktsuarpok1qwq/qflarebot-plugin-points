import { TOAST_STYLE, TOAST_SCRIPT } from './toast.js';
import { REPLY_EDITOR_HTML, REPLY_EDITOR_SCRIPT, REPLY_EDITOR_STYLE } from './editor/editor.js';
import { POLICY_EDITOR_SCRIPT } from './policies.js';
import { ADMIN_UI_SCRIPT } from './helpers.js';
import { LIMITS } from '../wallet/limits.js';
import { ADMIN_ACTION_SCRIPT } from './actions.js';
import { HISTORY_SCRIPT } from './history.js';
import { QQ_BINDING_HTML, ACCOUNT_SCRIPT } from './accounts.js';
import { RESPONSE_SCRIPT } from './responses.js';
import { PAGE_LAYOUT_SCRIPT } from './layout.js';

export const PAGE_HTML = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>积分管理</title><link rel="stylesheet" href="/tokens.css"><style>
*{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:var(--qb-border-strong) transparent}html{scrollbar-gutter:stable}html[data-embedded=true]{overflow-y:hidden}html[data-embedded=true].page-scroll{overflow-y:auto}::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--qb-border-strong);border-radius:var(--qb-radius-full)}body{margin:0;color:var(--qb-fg);font:14px var(--qb-font-sans);background:var(--qb-bg)}
.qb-page{max-width:1120px;margin:auto;padding:16px}.tabs,.actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.account-query{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin-bottom:16px}.account-query>label{flex:1;min-width:180px}.account-query>.field-error{flex-basis:100%;min-width:0}.section-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px}.section-header h2,.section-header h3,.section-header .actions{margin:0}.field-error{color:var(--qb-danger);font-size:13px;margin:0}.qb-input[aria-invalid=true],.qb-input[aria-invalid=true]:focus{border-color:var(--qb-danger)}.toggle{flex-direction:row;align-items:center;gap:12px;min-height:44px}.toggle input[role=switch]{appearance:none;position:relative;flex:none;width:44px;height:24px;min-height:24px;border:1px solid var(--qb-border-strong);border-radius:var(--qb-radius-full);background:var(--qb-surface-muted);cursor:pointer}.toggle input[role=switch]:before{content:"";display:block;position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;background:var(--qb-fg-muted)}.toggle input[role=switch]:checked{background:var(--qb-accent)}.toggle input[role=switch]:checked:before{left:23px;background:var(--qb-on-accent)}.toggle input:disabled{opacity:.5;cursor:not-allowed}.qb-btn--danger{background:var(--qb-danger-bg);color:var(--qb-danger)}.qb-btn--danger:hover{background:color-mix(in srgb,var(--qb-danger-bg),var(--qb-danger) 12%)}.qb-btn--destructive{background:var(--qb-danger);color:var(--qb-bg)}.qb-btn--destructive:hover{background:color-mix(in srgb,var(--qb-danger),var(--qb-fg) 10%)}.qb-btn:disabled:hover{background:var(--qb-surface-muted)}.qb-btn--primary:disabled:hover{background:var(--qb-primary)}.qb-btn--danger:disabled:hover{background:var(--qb-danger-bg)}.qb-card{padding:16px;margin:16px 0}h1{font-size:24px}h2{font-size:20px;margin-top:0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px}
.setting-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,280px);align-items:center;gap:12px 24px;padding:16px 0;border-bottom:1px solid var(--qb-border)}.setting-copy{min-width:0}.setting-copy>label{font-weight:500}.setting-copy>.hint{margin:4px 0 0}.setting-control{display:flex;align-items:center;justify-content:flex-end;min-width:0}.setting-control>.qb-input{width:100%;min-width:0}.setting-row>.field-error{grid-column:1/-1}.setting-switch{grid-template-columns:minmax(0,1fr) auto}label{display:flex;flex-direction:column;gap:6px}input,select,textarea,button{font:inherit}input,select,textarea{max-width:100%}.checks{display:flex;flex-wrap:wrap;gap:12px}.checks label{flex-direction:row;align-items:center}.management-block{margin-top:24px;padding-top:20px;border-top:1px solid var(--qb-border)}.management-block h3{margin-top:0}.management-block details{margin-top:16px}.management-block summary{padding:8px 0;line-height:28px;cursor:pointer}
.compensation-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:16px;align-items:end;margin-top:12px}.compensation-row>label{min-width:0}.compensation-row>.field-error{grid-column:2/-1}.compensation-row>.field-error[data-error-field=user]{grid-column:1/-1}.compensation-row input{width:100%;min-width:0}.compensation-row>button{height:var(--qb-control-height);min-height:var(--qb-control-height);white-space:nowrap}
[data-reason-slot]:not(:empty){margin-top:16px}#reason{height:auto;min-height:44px;padding:10px 12px;line-height:22px;resize:vertical}#detail-content{max-height:400px;overflow:auto}
button{cursor:pointer;min-height:36px}button:disabled{opacity:.5;cursor:not-allowed}.tabs button[aria-selected=true]{background:var(--qb-primary);color:var(--qb-on-primary)}
.identifier{font-family:var(--qb-font-mono);overflow-wrap:anywhere}
.loading-rows{padding:12px 0}.loading-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;padding:12px 0;border-bottom:1px solid var(--qb-border)}.loading-row span{height:14px;background:var(--qb-surface-muted);border-radius:var(--qb-radius)}
.hint{color:var(--qb-fg-muted);font-size:13px}#source-status,#history-scope{overflow-wrap:anywhere}
.error{color:var(--qb-danger)}.scroll{overflow:auto;max-height:650px}table{border-collapse:collapse;width:100%;min-width:680px;font-variant-numeric:tabular-nums}td,th{text-align:left;padding:10px;border-bottom:1px solid var(--qb-border);white-space:nowrap}td.wrap{white-space:normal;overflow-wrap:anywhere;min-width:100px;max-width:260px}:is(#source-list,#account-result,#binding-result) table{min-width:0}:is(#source-list,#account-result,#binding-result) td.wrap{min-width:0;max-width:none}#source-list td:first-child{width:100%}#source-list td:nth-child(2){white-space:nowrap}th{font-size:13px;color:var(--qb-fg-muted)}pre{white-space:pre-wrap;overflow-wrap:anywhere}
[hidden]{display:none!important}:focus-visible{outline:2px solid var(--qb-ring);outline-offset:3px}.viewport-probe{position:fixed;inset:0;pointer-events:none}dialog{position:fixed;inset:auto;top:var(--confirmation-top);left:var(--confirmation-left);transform:translate(-50%,-50%);margin:0;width:min(560px,calc(var(--confirmation-width) - 32px));max-width:none;max-height:calc(var(--confirmation-height) - 32px);overflow:auto;background:var(--qb-surface);color:var(--qb-fg);border:1px solid var(--qb-border);border-radius:var(--qb-radius-xl);padding:24px}dialog::backdrop{background:rgb(0 0 0/.3)}
@media(max-width:600px){button,input,select{min-height:44px}.qb-page{padding:12px}.grid{grid-template-columns:1fr}.setting-row{grid-template-columns:minmax(0,1fr);gap:12px}.setting-control{justify-content:flex-start}.compensation-row{grid-template-columns:minmax(0,1fr) auto;gap:12px}.compensation-row>label:first-child,.compensation-row>.field-error{grid-column:1/-1}.compensation-row>button{height:var(--qb-touch-min);min-height:var(--qb-touch-min)}}@media(max-width:600px){:is(#account-result,#binding-result) table{min-width:0}:is(#account-result,#binding-result) tr:first-child{display:none}:is(#account-result,#binding-result) tr:not(:first-child){display:grid;grid-template-columns:minmax(0,1fr);gap:0}:is(#account-result,#binding-result) td{display:grid;grid-template-columns:70px minmax(0,1fr);align-items:center;gap:12px;min-width:0;max-width:none;white-space:normal}:is(#account-result,#binding-result) td:before{content:attr(data-label);font:13px var(--qb-font-sans);color:var(--qb-fg-muted)}:is(#account-result,#binding-result) td button{justify-self:start}}
@media(pointer:coarse){button,.qb-input:not(#reason):not(#reply-body){min-height:var(--qb-touch-min)}.compensation-row>button{height:var(--qb-touch-min)}.checks label{min-height:var(--qb-touch-min)}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
/* toast-style */
/* reply-editor-style */
</style></head><body><main class="qb-page">
<h1 id="standalone">积分管理</h1>
<div id="reason-parking" hidden><label id="reason-field">管理操作原因<textarea id="reason" class="qb-input" maxlength="256" rows="1" placeholder="说明本次调整的原因" aria-describedby="reason-hint reason-error"></textarea><span id="reason-hint" class="hint">资金与政策操作会保存原因和操作编号</span><span id="reason-error" class="field-error" hidden></span></label></div>
<nav class="tabs" role="tablist" aria-label="管理区域">
<button class="qb-btn" role="tab" data-tab="account" aria-selected="true">账户</button>
<button class="qb-btn" role="tab" data-tab="history">交易</button>
<button class="qb-btn" role="tab" data-tab="reserve">预留</button>
<button class="qb-btn" role="tab" data-tab="records">管理记录</button>
<button class="qb-btn" role="tab" data-tab="source">来源权限</button>
<button class="qb-btn" role="tab" data-tab="wallet">转账设置</button>
<button class="qb-btn" role="tab" data-tab="replies">消息模板</button></nav>
<div id="operation-bar" class="actions" hidden><button id="retry" class="qb-btn" hidden>使用原编号重试</button><span id="operation" class="hint"></span></div>
<section id="account" role="tabpanel" class="qb-card"><h2>账户</h2>
<p id="account-hint" class="hint">账户在当前机器人内共享，不按群拆分</p><div class="account-query"><label>账户 SID<input id="user" class="qb-input identifier" maxlength="128" aria-describedby="account-hint"></label><button id="account-load" class="qb-btn">查询账户</button></div><div id="account-result"><p class="hint">尚未加载，请点击查询查看</p></div>
<!-- qq-binding -->
<details id="adjustment-panel" class="management-block"><summary>积分调整与账户状态</summary><p class="hint">操作对象为上方 SID 输入框中的账户；发行、销毁和暂停／恢复均需填写原因并确认。</p><p id="adjustment-target" class="hint identifier"></p><div class="grid"><label>金额（积分）<input id="amount" class="qb-input" inputmode="decimal" placeholder="0.00"></label>
<label>业务关联（可选）<input id="reference" class="qb-input identifier" maxlength="128"></label></div>
<div data-reason-slot="account"></div><div class="actions"><button id="credit" class="qb-btn qb-btn--primary">发行积分</button><button id="burn" class="qb-btn qb-btn--danger">销毁积分</button></div><h3>账户状态</h3><div class="actions"><button id="suspend" class="qb-btn qb-btn--danger">暂停支出</button><button id="resume" class="qb-btn">恢复支出</button></div>
</details></section>
<section id="history" role="tabpanel" class="qb-card" hidden><h2>交易查询</h2><div class="grid"><label>北京月份<input type="month" id="month" class="qb-input"></label><label>账户 SID（可选）<input id="history-user" class="qb-input identifier" maxlength="128"></label><label>来源（可选）<input id="history-source" class="qb-input identifier" maxlength="128"></label></div>
<div class="actions"><button id="history-load" class="qb-btn">查询</button><button id="history-next" class="qb-btn" disabled>下一页</button></div><p id="history-scope" class="hint"></p><div id="history-result"><p class="hint">尚未加载，请点击查询查看</p></div>
<details id="correction-panel" class="management-block"><summary>交易纠错</summary>
<p class="hint">先从交易查询选择原交易，或在下方填写交易编号。发行、销毁和普通转账可完整冲正；复杂结算使用关联补偿。</p>
<div class="grid"><label>原交易编号<input id="original" class="qb-input identifier" maxlength="128"></label></div><div data-reason-slot="history"></div><div class="actions"><button id="reverse" class="qb-btn qb-btn--danger">完整冲正</button></div>
<details id="compensation-panel"><summary>复杂结算补偿</summary><p class="hint">使用本区的原交易编号，扣回仅使用可用余额，不恢复原预留。补发作为新发行记入账本。</p>
<div id="vectors"></div><div class="actions"><button id="add-credit" class="qb-btn">添加补发</button><button id="add-burn" class="qb-btn">添加扣回</button><button id="compensate" class="qb-btn">确认补偿方案</button></div></details></details>
<section class="management-block" aria-labelledby="export-title"><h3 id="export-title">整月流水导出</h3><p class="hint">导出所选北京月份的全部账户和来源，不受上方账户、来源筛选影响。文件用于当月流水核对，不含月初/月末余额或冻结存量。</p><div class="actions"><button id="history-export" class="qb-btn">导出整月流水 JSON</button><button id="export-cancel" class="qb-btn" hidden>取消导出</button></div><p id="export-status" class="hint" role="status" aria-live="polite"></p></section></section>
<section id="reserve" role="tabpanel" class="qb-card" hidden><div class="section-header"><h2>待处理预留</h2><button id="reserve-load" class="qb-btn">加载待处理</button></div><p class="hint">按到期时间展示仍占冻结的本金，包含已到期待释放的记录，每页 15 条。操作后结果可能变化，请点击重新加载查看。</p><div class="actions"><button id="reserve-next" class="qb-btn" disabled>下一页</button><button id="expire" class="qb-btn">推进一次到期释放</button></div><div data-reason-slot="reserve" hidden></div><div id="reserve-result"><p class="hint">尚未加载，请点击加载查看</p></div><h3>查询指定预留</h3><div class="grid"><label>来源<input id="reserve-source" class="qb-input identifier" maxlength="128"></label><label>预留 ID<input id="reserve-id" class="qb-input identifier" maxlength="128"></label></div><button id="reserve-find" class="qb-btn">查询指定记录</button></section>
<section id="records" role="tabpanel" class="qb-card" hidden><h2>管理记录</h2><section id="operations-panel" aria-labelledby="operations-title"><div class="section-header"><h3 id="operations-title">最近管理操作</h3><button id="operations-load" class="qb-btn">查询最近操作</button></div><p class="hint">手动查询已保存的管理操作，每页 15 条。包含已完成和已拒绝的操作；不包含取消或未落库的请求，也不提供设置变更前后对照。请在原因中写明对象和调整内容。</p><div class="actions"><button id="operations-next" class="qb-btn" disabled>下一页</button></div><div id="operations-result"><p class="hint">尚未加载，请点击查询查看</p></div>
<details id="lookup-panel"><summary>查询管理操作</summary><p class="hint">此处仅查看已保存结果，不会重新执行操作或修改余额。结果不明时填写原来源和操作编号；管理操作也可点击上方“查看结果”。查询结果显示在下方详情区。</p><div class="grid"><label>来源<input id="lookup-source" class="qb-input identifier" value="admin" maxlength="128"></label><label>操作编号<input id="lookup-id" class="qb-input identifier" maxlength="128"></label></div><div class="actions"><button id="lookup" class="qb-btn">查询管理操作</button></div></details></section></section>
<section id="source" role="tabpanel" class="qb-card" hidden><div class="section-header"><h2>来源权限</h2><button id="source-load" class="qb-btn">加载来源</button></div><div id="source-list"><p class="hint">尚未加载，请点击加载查看</p></div>
<div class="setting-row"><div class="setting-copy"><label for="source-id">来源标识</label><p id="source-id-hint" class="hint">插件主动登记后选择记录编辑；重复登记不会覆盖权限</p></div><div class="setting-control"><input id="source-id" class="qb-input identifier" maxlength="128" aria-describedby="source-id-hint"></div></div>
<div class="setting-row setting-switch"><div class="setting-copy"><label for="source-enabled">启用此来源</label><p id="source-enabled-hint" class="hint">插件登记默认禁用；启用即允许发行，其余权限按需勾选，发行金额记入流水</p></div><label class="setting-control toggle" for="source-enabled"><input type="checkbox" role="switch" id="source-enabled" aria-describedby="source-enabled-hint" checked></label></div>
<h3>资金权限</h3><div id="permissions" class="checks"></div><h3>读取权限</h3><div class="checks"><label><input id="read-balance" type="checkbox">余额</label><label><input id="read-transactions" type="checkbox">流水</label></div>
<div data-reason-slot="source"></div><div class="actions"><button id="source-new" class="qb-btn">新建来源</button><button id="source-save" class="qb-btn qb-btn--primary">保存来源</button><button id="source-discard" class="qb-btn">撤销修改</button></div><p id="source-status" class="hint" role="status" aria-live="polite">当前为新来源</p></section>
<section id="wallet" role="tabpanel" class="qb-card" hidden><div class="section-header"><h2>转账设置</h2><button id="wallet-load" class="qb-btn">加载设置</button></div><div class="setting-row setting-switch"><div class="setting-copy"><label for="wallet-enabled">允许用户转账</label><p id="wallet-enabled-hint" class="hint">只影响 QQ 用户；关闭后阻止未执行的转账，Service 按来源权限独立控制</p></div><label class="setting-control toggle" for="wallet-enabled"><input type="checkbox" role="switch" id="wallet-enabled" aria-describedby="wallet-enabled-hint" disabled></label></div>
<div class="setting-row"><div class="setting-copy"><label for="fee-mode">收费方式</label><p id="fee-mode-hint" class="hint">待确认转账保留原手续费，已收手续费全部销毁</p></div><div class="setting-control"><select id="fee-mode" class="qb-input" aria-describedby="fee-mode-hint"><option value="free">免费</option><option value="proportional">按比例收费</option></select></div></div>
<div class="setting-row"><div class="setting-copy"><label for="fee-rate">手续费比例（%）</label><p id="fee-rate-hint" class="hint">按分向下取整，无最低收费</p></div><div class="setting-control"><input id="fee-rate" class="qb-input" inputmode="decimal" value="0" aria-describedby="fee-rate-hint"></div></div>
<div data-reason-slot="wallet" hidden></div><div class="actions"><button id="wallet-save" class="qb-btn qb-btn--primary">保存设置</button><button id="wallet-discard" class="qb-btn">撤销修改</button></div><p id="wallet-status" class="hint" role="status" aria-live="polite">尚未加载</p></section>
<!-- reply-editor -->
<section id="detail" class="qb-card" aria-labelledby="detail-title" hidden><div class="section-header"><h2 id="detail-title" tabindex="-1">详情</h2><button id="detail-close" class="qb-btn">收起详情</button></div><div id="detail-content"></div></section>
<dialog id="confirmation" aria-labelledby="dialog-title" aria-describedby="dialog-description"><h2 id="dialog-title">确认管理操作</h2><pre id="dialog-description"></pre><div class="actions"><button id="cancel" class="qb-btn" autofocus>取消</button><button id="accept" class="qb-btn qb-btn--primary">确认执行</button></div></dialog>
</main><script type="module">
import { createBridge } from '/bridge.js';

const $ = id => document.getElementById(id), val = id => $(id).value.trim();
const bridge = await createBridge();
bridge.setTitle('积分管理');
/* page-layout-script */
$('standalone').hidden = bridge.embedded;
let historyCursor, historyFilters, historyRequest = 0, operationsCursor, viewVersion = 0;
/* ui-limits */
const readVersions = new Map();
/* toast-script */
const notice = createToast(bridge);
$('reason').addEventListener('input', event => {
    const input = event.currentTarget;
    resizeReason();

    if (input.value.trim()) { clearFieldError(input); }
});
const money = n => {
    const v = BigInt(n ?? 0), a = v < 0n ? -v : v;

    return (v < 0n ? '-' : '') + (a / 100n) + '.' + String(a % 100n).padStart(2, '0');
};
const amount = (text, maximum = 1000000000000n) => {
    if (!/^(0|[1-9]\d{0,13})(\.\d{1,2})?$/.test(text)) {
        throw Error('请输入最多两位小数的非负积分金额');
    }

    const [a, b = ''] = text.split('.');
    const n = BigInt(a) * 100n + BigInt(b.padEnd(2, '0'));

    if (n === 0n) {
        throw Error('请输入大于零的积分金额');
    }

    if (n > maximum) {
        throw Error('金额超过允许上限');
    }

    return Number(n);
};

function on(id, fn) {
    $(id).addEventListener('click', async () => {
        const el = $(id), view = viewVersion;
        el.disabled = true;
        el.setAttribute('aria-busy', 'true');

        try {
            await fn();
        } catch (e) {
            if (view === viewVersion) { notice(e.message || String(e), true); }
        } finally {
            el.disabled = id === 'reserve-next' ? !reserveCursor : id === 'history-next' ? !historyCursor : id === 'operations-next' ? !operationsCursor : false;
            el.removeAttribute('aria-busy');

            if (id.startsWith('source-') || id.startsWith('wallet-')) { syncPolicyEditors(); }

            if (id === 'retry') { syncRetry(); }

            if (id.startsWith('binding-')) { syncBindingControls(); }

            if (['add-credit', 'add-burn'].includes(id)) { syncVectorButtons(); }

            if (view === viewVersion) { restoreFocus(el, ['binding-save', 'binding-unbind'].includes(id) ? $('binding-find') : $(policyFocus[id])); }
        }
    });
}

/* admin-action-script */

/* admin-ui-script */
/* response-script */

function rowButton(container, label, fn, fallback) {
    const b = document.createElement('button');
    b.className = 'qb-btn' + (['移除此项', '释放'].includes(label) ? ' qb-btn--danger' : '');
    b.textContent = label;
    b.onclick = async () => {
        b.disabled = true;
        b.setAttribute('aria-busy', 'true');
        const view = viewVersion;

        try {
            await fn();
        } catch (e) {
            if (view === viewVersion) { notice(e.message, true); }
        } finally {
            b.disabled = false;
            b.removeAttribute('aria-busy');

            if (view === viewVersion) { restoreFocus(b, fallback); }
        }
    };

    if (label === '释放') { b.dataset.release = 'true'; }

    container.append(b);
}

const date = ms => new Date(ms).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
const tabs = [...document.querySelectorAll('[data-tab]')];
let activeTab = null;

let detailRequest = 0, detailTrigger = null, detailKind = null;

function clearDetail(kind) {
    if (kind && detailKind !== kind) { return; }

    detailRequest++;
    detailKind = null;
    detailTrigger = null;
    $('detail').hidden = true;
    $('detail-title').textContent = '详情';
    $('detail-content').replaceChildren();
    syncReservationReason();
}

function showDetail(title, render, trigger = document.activeElement, kind = null) {
    clearDetail();
    detailKind = kind;
    detailTrigger = trigger;
    $('detail-title').textContent = title;
    render();
    $('detail').hidden = false;
    syncReservationReason();
    $('detail-title').focus();
    $('detail').scrollIntoView({ block: 'nearest' });
}

function showJsonDetail(title, data, trigger, kind) {
    showDetail(title, () => {
        const text = document.createElement('pre');
        text.textContent = JSON.stringify(data, null, 2);
        $('detail-content').append(text);
    }, trigger, kind);
}

on('detail-close', () => {
    const trigger = detailTrigger;
    clearDetail();

    if (trigger?.getClientRects().length) { trigger.focus(); } else { tabs.find(tab => tab.getAttribute('aria-selected') === 'true')?.focus(); }
});

function syncReason() {
    const area = activeTab?.dataset.tab;
    const slot = [...document.querySelectorAll('[data-reason-slot]')].find(node => node.dataset.reasonSlot === area && !node.hidden && !node.closest('details:not([open])'));
    const target = slot || $('reason-parking');

    if ($('reason-field').parentElement !== target) { target.append($('reason-field')); }
}

for (const id of ['adjustment-panel', 'correction-panel']) { $(id).addEventListener('toggle', syncReason); }

function showTab(tab) {
    if (tab === activeTab) { return; }

    activeTab = tab;
    viewVersion++;
    historyRequest++;
    clearDetail();

    for (const b of tabs) {
        const active = b === tab;
        b.setAttribute('aria-selected', String(active));
        b.tabIndex = active ? 0 : -1;
        $(b.dataset.tab).hidden = !active;
    }

    syncReason();
    tab.focus();
}

for (const [i, b] of tabs.entries()) {
    b.id = 'tab-' + b.dataset.tab;
    b.setAttribute('aria-controls', b.dataset.tab);
    $(b.dataset.tab).setAttribute('aria-labelledby', b.id);
    b.onclick = () => showTab(b);
    b.onkeydown = e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            showTab(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]);
        }
    };
}

showTab(tabs[0]);

/* account-script */

for (const action of ['credit', 'burn']) {
    on(action, () => submit({ action, userId: identifierField('user', '请填写账户 SID'), amountMinor: amountField('amount'), ...(identifierField('reference', '', true) ? { referenceId: val('reference') } : {}) }, (action === 'credit' ? '发行' : '销毁') + ' ' + val('amount') + ' 积分\n账户：' + val('user')));
}

for (const [id, status] of [['suspend', 'suspended'], ['resume', 'active']]) {
    on(id, () => submit({ action: 'status', userId: identifierField('user', '请填写账户 SID'), status }, (status === 'active' ? '恢复' : '暂停') + '账户主动支出：' + val('user') + '\n暂停仍允许新入账及既有预留结算'));
}

on('reverse', async () => {
    const id = identifierField('original', '请填写原交易编号');
    actionReason();
    const current = readContext('reverse-preview', ['original']);
    let original;

    try { original = await get('transaction', { id }); } catch (error) {
        if (current()) { throw error; }

        return;
    }

    if (!current()) { return; }

    if (!['mint', 'burn', 'transfer'].includes(original.type)) {
        throw Error('此交易仅支持关联补偿');
    }

    if (original.reversal_tx_id) {
        throw Error('此交易已完整冲正');
    }

    const changes = original.ledger.entries.map(entry => (entry.bucket === 'supply' ? '总存量对方科目' : '账户 ' + entry.accountId) + '：' + money(-entry.deltaMinor));
    const users = [...new Set(original.ledger.entries.filter(entry => entry.bucket !== 'supply').map(entry => entry.accountId))];
    await submit({ action: 'reverseOwn', originalTransactionId: original.tx_id, ...(original.reference_id ? { referenceId: original.reference_id } : {}) }, '完整冲正 ' + original.tx_id + '\n' + changes.join('\n') + '\n已销毁手续费一并恢复；扣回余额不足时整笔拒绝。', undefined, users);
});

function syncVectorButtons() {
    for (const id of ['add-credit', 'add-burn']) { $(id).disabled = $('vectors').children.length >= UI_LIMITS.payouts; }
}

function clearCompensationDuplicates() {
    for (const input of $('vectors').querySelectorAll('[data-duplicate-account]')) {
        clearFieldError(input);
        delete input.dataset.duplicateAccount;
    }
}

$('vectors').addEventListener('input', event => {
    if (event.target.matches('[data-field=user]')) { clearCompensationDuplicates(); }
});

function vector(kind) {
    if ($('vectors').children.length >= UI_LIMITS.payouts) { throw Error('补发和扣回合计最多 32 项'); }

    const row = document.createElement('div');
    row.className = 'compensation-row';
    row.dataset.kind = kind;

    for (const [label, key] of [['账户 SID', 'user'], ['金额', 'amount']]) {
        const l = document.createElement('label');
        l.textContent = (kind === 'credits' ? '补发' : '扣回') + ' ' + label;
        const i = document.createElement('input');
        i.className = 'qb-input' + (key === 'user' ? ' identifier' : '');

        if (key === 'user') { i.maxLength = UI_LIMITS.idCharacters; }

        i.dataset.field = key;
        l.append(i);
        row.append(l);
    }

    rowButton(row, '移除此项', () => {
        const adjacent = row.nextElementSibling || row.previousElementSibling;
        row.remove();
        clearCompensationDuplicates();
        syncVectorButtons();
        (adjacent?.querySelector('[data-field=user]') || $(kind === 'credits' ? 'add-credit' : 'add-burn')).focus();
    });
    $('vectors').append(row);
    syncVectorButtons();
    row.querySelector('[data-field=user]').focus();
}

on('add-credit', () => vector('credits'));
on('add-burn', () => vector('burns'));
on('compensate', () => {
    const originalTransactionId = identifierField('original', '请填写原交易编号');
    const credits = [], burns = [], seen = { credits: new Set(), burns: new Set() };
    clearCompensationDuplicates();

    if ($('vectors').children.length > UI_LIMITS.payouts) { throw Error('补发和扣回合计最多 32 项'); }

    if (!$('vectors').children.length) {
        $('add-credit').focus();
        throw Error('请添加至少一项补发或扣回');
    }

    for (const row of $('vectors').children) {
        const field = row.querySelector('[data-field=user]'), userId = identifierField(field, '请填写账户 SID');

        if (seen[row.dataset.kind].has(userId)) {
            field.dataset.duplicateAccount = 'true';
            fieldError(field, '同类补偿中不能重复填写此账户');
        }

        seen[row.dataset.kind].add(userId);
        const item = { userId, amountMinor: amountField(row.querySelector('[data-field=amount]')) };
        (row.dataset.kind === 'credits' ? credits : burns).push(item);
    }

    return submit({ action: 'compensate', originalTransactionId, credits, burns }, '补偿关联交易 ' + val('original') + '\n' + credits.map(p => '补发 ' + p.userId + '：' + money(p.amountMinor)).concat(burns.map(p => '扣回 ' + p.userId + '：' + money(p.amountMinor))).join('\n') + '\n原交易与预留不改写');
});

async function loadOperationResult(source, id, trigger = document.activeElement) {
    clearDetail();
    detailKind = 'operation';
    const request = detailRequest;
    let observed;
    const displayed = await readView('operation', { source, id }, data => {
        if (request === detailRequest) {
            observed = operationResult(data, id);
            showJsonDetail('操作结果', data, trigger, 'operation');
        }
    }, ['lookup-source', 'lookup-id'], undefined, () => request === detailRequest);

    if (displayed) { await recoverPending(source, id, observed); }
}

on('lookup', () => {
    clearDetail();

    return loadOperationResult(identifierField('lookup-source', '请填写来源'), identifierField('lookup-id', '请填写操作编号'));
});

/* history-script */
/* policy-editor-script */
let reserveCursor, reserveReading = false;

function syncReservationReason() {
    const slot = document.querySelector('[data-reason-slot=reserve]');
    slot.hidden = !document.querySelector('#reserve-result button,#detail-content button[data-release]');
    syncReason();
}

function showReservations(target, rows) {
    table(target, [['来源', r => r.source], ['编号', r => r.reservation_id], ['账户', r => r.user_id], ['状态', r => r.status === 'active' ? (r.expires_at_ms <= r.observed_at_ms ? '已到期待释放' : '冻结中') : ({ released: '已释放', consumed: '已结算', expired: '已到期释放' }[r.status] || r.status)], ['金额', r => money(r.amount_minor)], ['到期（北京）', r => date(r.expires_at_ms)], ['业务关联', r => r.reference_id]], rows, (r, td) => {
        if (r.status === 'active') {
            rowButton(td, '释放', async () => {
                await submit({ action: 'release', targetSource: r.source, reservationId: r.reservation_id }, '释放预留 ' + r.source + ' / ' + r.reservation_id + '\n退还本金 ' + money(r.amount_minor) + '；原业务将不能再使用该预留结算', invalidateReservations, [r.user_id]);
            }, $(target === 'detail-content' ? 'reserve-find' : 'reserve-load'));
        }
    });
    syncReservationReason();
}

function invalidateReservations() {
    clearDetail('fund');
    readVersions.set('funds', (readVersions.get('funds') || 0) + 1);
    $('reserve-result').removeAttribute('aria-busy');
    reserveCursor = undefined;
    $('reserve-next').disabled = true;
    $('reserve-load').textContent = '重新加载';
    $('reserve-result').textContent = '预留状态可能已变化，请点击重新加载查看';
    syncReservationReason();
}

async function loadReservations(cursor) {
    if (reserveReading) { return; }

    reserveReading = true;
    clearDetail();

    if (!cursor) { reserveCursor = undefined; }

    $('reserve-load').disabled = true;
    $('reserve-next').disabled = true;

    try {
        const displayed = await readView('funds', cursor ? { cursor } : {}, data => {
            reserveCursor = data.nextCursor;
            $('reserve-load').textContent = '重新加载';
            showReservations('reserve-result', data.items);
        }, [], 'reserve-result');

        if (!displayed) { reserveCursor = undefined; }
    } finally {
        reserveReading = false;
        $('reserve-load').disabled = false;
        $('reserve-next').disabled = !reserveCursor;
        syncReservationReason();
    }
}

async function findReservation() {
    clearDetail();
    detailKind = 'fund';
    const request = detailRequest, trigger = document.activeElement;
    const source = identifierField('reserve-source', '请填写来源'), id = identifierField('reserve-id', '请填写预留 ID');
    await readView('fund', { source, id }, row => {
        if (request === detailRequest) { showDetail('预留详情', () => showReservations('detail-content', row ? [row] : []), trigger, 'fund'); }
    }, ['reserve-source', 'reserve-id'], undefined, () => request === detailRequest);
}

for (const [kind, fields] of [['operation', ['lookup-source', 'lookup-id']], ['fund', ['reserve-source', 'reserve-id']], ['transaction', ['original']]]) {
    for (const id of fields) { $(id).addEventListener('input', () => clearDetail(kind)); }
}

on('reserve-load', () => loadReservations());
on('reserve-next', () => loadReservations(reserveCursor));
on('reserve-find', findReservation);
on('expire', async () => {
    const view = viewVersion;
    const result = await post({ action: 'expire' });

    if (!result.ok) {
        throw Error(result.message || result.code);
    }

    if (view === viewVersion) { notice('本次到期释放已完成'); }

    invalidateAccount();
    invalidateReservations();
    invalidateHistory();
});
/* reply-editor-script */
document.documentElement.dataset.ready = 'true';
</script></body></html>`
    .replace('<!-- qq-binding -->', () => QQ_BINDING_HTML)
    .replace('/* account-script */', () => ACCOUNT_SCRIPT)
    .replace('<!-- reply-editor -->', () => REPLY_EDITOR_HTML)
    .replace('/* reply-editor-style */', () => REPLY_EDITOR_STYLE)
    .replace('/* toast-style */', () => TOAST_STYLE)
    .replace('/* toast-script */', () => TOAST_SCRIPT)
    .replace('/* ui-limits */', () => 'const UI_LIMITS = ' + JSON.stringify(LIMITS) + ';')
    .replace('/* admin-action-script */', () => ADMIN_ACTION_SCRIPT)
    .replace('/* admin-ui-script */', () => ADMIN_UI_SCRIPT)
    .replace('/* response-script */', () => RESPONSE_SCRIPT)
    .replace('/* page-layout-script */', () => PAGE_LAYOUT_SCRIPT)
    .replace('/* history-script */', () => HISTORY_SCRIPT)
    .replace('/* policy-editor-script */', () => POLICY_EDITOR_SCRIPT)
    .replace('/* reply-editor-script */', () => REPLY_EDITOR_SCRIPT);
