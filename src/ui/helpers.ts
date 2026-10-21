// 页面字段反馈、只读请求归属与展示名称，不参与资金校验或持久化。
export const ADMIN_UI_SCRIPT = String.raw`
function pointsFailure(data) {
    return data?.ok === false && typeof data.code === 'string' && data.code.trim().length > 0
        && typeof data.message === 'string' && data.message.trim().length > 0 && typeof data.retryable === 'boolean';
}

async function responseData(response, action) {
    let data;

    try { data = await response.json(); } catch { throw Error('服务响应无法解析，请稍后重试'); }

    const failure = pointsFailure(data);

    if (failure) {
        if (action) { return data; }

        throw Error(data.message);
    }

    if (!response.ok || data?.ok !== true || (action !== 'expire' && !Object.hasOwn(data, 'data'))
        || (action && action !== 'expire' && (!data.data || typeof data.data !== 'object' || Array.isArray(data.data)))) {
        throw Error(typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : '服务响应不符合要求，请稍后重试');
    }

    return data;
}

async function get(kind, params = {}) {
    const response = await bridge.fetch('/api/state?' + new URLSearchParams({ kind, ...params }));

    return checkedState(kind, params, (await responseData(response)).data);
}

function encodeAction(body) {
    const json = JSON.stringify(body);

    if (new TextEncoder().encode(json).byteLength > UI_LIMITS.requestBytes) { throw Error('提交内容超过 65536 字节，请精简后重试'); }

    return json;
}

async function post(body) {
    const response = await bridge.fetch('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: encodeAction(body) });

    return responseData(response, body.action);
}

function table(id, columns, rows, actions, empty = '暂无记录') {
    const box = $(id);
    box.replaceChildren();

    if (!rows?.length) {
        box.textContent = empty;

        return;
    }

    const scroll = document.createElement('div');
    scroll.className = 'scroll';
    const t = document.createElement('table'), head = document.createElement('tr');

    for (const [label] of columns) {
        const th = document.createElement('th');
        th.textContent = label;
        head.append(th);
    }

    if (actions) {
        const th = document.createElement('th');
        th.textContent = '操作';
        head.append(th);
    }

    t.append(head);

    for (const row of rows) {
        const tr = document.createElement('tr');

        for (const [label, read] of columns) {
            const td = document.createElement('td');
            td.className = 'wrap' + (['SID', '来源', '编号', '账户', '操作编号', '交易编号', '业务关联'].includes(label) ? ' identifier' : '');
            td.dataset.label = label;
            td.textContent = String(read(row) ?? '—');
            tr.append(td);
        }

        if (actions) {
            const td = document.createElement('td');
            td.dataset.label = '操作';
            actions(row, td);
            tr.append(td);
        }

        t.append(tr);
    }

    scroll.append(t);
    box.append(scroll);
}

async function visibleArea() {
    const probe = document.createElement('div');
    probe.className = 'viewport-probe';
    document.body.append(probe);

    // 观察结果包含宿主对 iframe 的裁切，避免按整个长页面定位确认框。
    return new Promise(resolve => {
        const observer = new IntersectionObserver(([entry]) => {
            observer.disconnect();
            probe.remove();
            const rect = entry.intersectionRect, viewport = window.visualViewport;
            const left = Math.max(rect.left, viewport?.offsetLeft || 0), top = Math.max(rect.top, viewport?.offsetTop || 0);
            const right = Math.min(rect.right, viewport ? viewport.offsetLeft + viewport.width : innerWidth);
            const bottom = Math.min(rect.bottom, viewport ? viewport.offsetTop + viewport.height : innerHeight);
            resolve({ left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) });
        });
        observer.observe(probe);
    });
}

const policyFocus = { 'source-save': 'source-id', 'source-discard': 'source-id', 'wallet-save': 'wallet-enabled', 'wallet-discard': 'wallet-enabled' };

function restoreFocus(control, fallback) {
    const active = document.activeElement;

    if (active !== document.body && active?.getClientRects().length && !active.disabled) { return; }

    const target = [control, fallback].find(node => node?.isConnected && !node.disabled && node.getClientRects().length);
    target?.focus({ preventScroll: true });
}

function clearFieldError(input) {
    const error = $(input.id + '-error');

    if (error) {
        error.hidden = true;
        input.removeAttribute('aria-invalid');
        const descriptions = (input.getAttribute('aria-describedby') || '').split(' ').filter(id => id && id !== error.id);

        if (descriptions.length) { input.setAttribute('aria-describedby', descriptions.join(' ')); } else { input.removeAttribute('aria-describedby'); }
    }
}

function resizeReason() {
    const input = $('reason');

    if (!input.getClientRects().length) { return; }

    input.style.height = 'auto';
    input.style.height = (input.scrollHeight + 2) + 'px';
}

let reasonWidth = 0;
new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width;

    if (width !== reasonWidth) {
        reasonWidth = width;
        resizeReason();
    }
}).observe($('reason-field'));

function fillFields(values) {
    for (const [id, value] of Object.entries(values)) { $(id).value = value; }

    for (const id of Object.keys(values)) { $(id).dispatchEvent(new Event('input', { bubbles: true })); }
}

function fieldError(id, message) {
    const input = typeof id === 'string' ? $(id) : id;

    if (!input.id) { input.id = 'field-' + crypto.randomUUID(); }

    let error = $(input.id + '-error');

    if (!error) {
        error = document.createElement('span');
        error.id = input.id + '-error';
        error.className = 'field-error';
        error.dataset.errorField = input.dataset.field || '';
        // 同排查询或补偿控件的错误独占下一行，不撑高单侧标签。
        (input.closest('.account-query,.compensation-row,.setting-row') || input.closest('label')).append(error);
    }

    error.textContent = message;
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', [...new Set((input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean).concat(error.id))].join(' '));
    input.focus();
    throw Error(message);
}

function required(id, message) {
    const input = typeof id === 'string' ? $(id) : id;
    const value = input.value.trim();

    if (!value) { fieldError(input, message); }

    return value;
}

function identifierField(id, message, optional = false) {
    const input = typeof id === 'string' ? $(id) : id, value = input.value.trim();

    if (!value && optional) { return ''; }

    if (!value) { fieldError(input, message); }

    if (value.length > UI_LIMITS.idCharacters || /[\s\x00-\x1f\x7f]/u.test(value)) { fieldError(input, '标识最多 128 字符，不能含空白或控制字符'); }

    return value;
}

function amountField(id) {
    const input = typeof id === 'string' ? $(id) : id;

    try { return amount(input.value.trim()); } catch (error) { fieldError(input, error.message); }
}

function monthField() {
    const month = required('month', '请选择北京月份');

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { fieldError('month', '请选择四位年份及有效月份，如 2026-10'); }

    return month;
}

const inputRevisions = new WeakMap();
document.addEventListener('input', event => {
    if (event.target.matches('input,select,textarea')) {
        inputRevisions.set(event.target, (inputRevisions.get(event.target) || 0) + 1);
        clearFieldError(event.target);
    }
});

function inputValue(input) {
    return input.type === 'checkbox' ? input.checked : input.value;
}

function readContext(kind, fields = []) {
    const version = (readVersions.get(kind) || 0) + 1, view = viewVersion;
    // 字段组保留控件身份，增删条目或改走再改回也不能接收旧反馈。
    const controls = () => fields.flatMap(id => $(id).matches('input,select,textarea') ? [$(id)] : [...$(id).querySelectorAll('input,select,textarea')]);
    const original = controls();
    const snapshot = inputs => JSON.stringify(inputs.map(input => [inputValue(input), inputRevisions.get(input) || 0]));
    const values = snapshot(original);
    readVersions.set(kind, version);
    const current = () => {
        if (!current.latest() || view !== viewVersion) { return false; }

        const inputs = controls();

        return inputs.length === original.length && inputs.every((input, index) => input === original[index]) && values === snapshot(inputs);
    };
    current.latest = () => readVersions.get(kind) === version;

    return current;
}

function loadingRows(target) {
    const rows = document.createElement('div');
    rows.className = 'loading-rows';
    rows.setAttribute('role', 'status');
    rows.setAttribute('aria-label', '正在查询');

    for (let index = 0; index < 3; index++) {
        const row = document.createElement('div');
        row.className = 'loading-row';
        row.setAttribute('aria-hidden', 'true');
        row.append(...Array.from({ length: 3 }, () => document.createElement('span')));
        rows.append(row);
    }

    target.replaceChildren(rows);
}

async function readView(kind, params, render, fields = [], statusId, applicable = () => true) {
    const current = readContext(kind, fields), status = statusId && $(statusId);
    let displayed = false;

    if (status) {
        loadingRows(status);
        status.setAttribute('aria-busy', 'true');
    }

    try {
        const data = await get(kind, params);

        if (current() && applicable()) {
            render(data);
            displayed = true;
        }
    } catch (error) {
        if (current() && applicable()) {
            if (status) { status.textContent = '查询失败，请重试'; }

            throw error;
        }
    } finally {
        if (status && current.latest()) {
            status.removeAttribute('aria-busy');

            if (!displayed && status.querySelector('.loading-rows')) { status.textContent = '查询条件已变化，请重新查询'; }
        }
    }

    return displayed;
}

const transactionNames = { mint: '发行', burn: '销毁', transfer: '转账', reserve: '冻结本金', release: '释放本金', settle: '结算', reverse: '完整冲正', compensate: '关联补偿' };
const transactionType = type => transactionNames[type] || type;
`;
