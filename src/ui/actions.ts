// 管理操作确认、待确认结果和浏览器恢复；不改变服务端幂等及资金规则。
export const ADMIN_ACTION_SCRIPT = String.raw`
let pending = null, pendingCommit = null, pendingAccounts, pendingReasonRevision, confirming = false;
const pendingSends = new Set();

async function confirm(text, { title = '确认管理操作', accept = '确认执行', danger = false } = {}) {
    if (confirming) { return false; }

    confirming = true;
    const dialog = $('confirmation');
    let stop = () => { };

    try {
        const area = await visibleArea();

        if (!area.width || !area.height) { return false; }

        const position = bounds => {
            for (const [key, value] of Object.entries({ top: bounds.top + bounds.height / 2, left: bounds.left + bounds.width / 2, width: bounds.width, height: bounds.height })) {
                dialog.style.setProperty('--confirmation-' + key, value + 'px');
            }
        };
        position(area);
        $('dialog-description').textContent = text;
        $('dialog-title').textContent = title;
        $('accept').textContent = accept;
        $('accept').className = 'qb-btn ' + (danger ? 'qb-btn--destructive' : 'qb-btn--primary');
        const focus = document.activeElement, scroll = { x: window.scrollX, y: window.scrollY };
        let frame, revision = 0;
        const resize = () => {
            const current = ++revision;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(async () => {
                const bounds = await visibleArea();

                if (dialog.open && current === revision) { position(bounds); }
            });
        };
        window.addEventListener('resize', resize);
        window.visualViewport?.addEventListener('resize', resize);
        window.visualViewport?.addEventListener('scroll', resize);
        // SDK 不提供父页滚动事件；仅在弹窗打开时采样裁切范围，不发网络请求。
        const timer = setInterval(() => { if (!document.hidden) { resize(); } }, 100);
        stop = () => {
            revision++;
            cancelAnimationFrame(frame);
            clearInterval(timer);
            window.removeEventListener('resize', resize);
            window.visualViewport?.removeEventListener('resize', resize);
            window.visualViewport?.removeEventListener('scroll', resize);
        };
        dialog.showModal();
        $('cancel').focus({ preventScroll: true });
        window.scrollTo(scroll.x, scroll.y);

        return await new Promise(resolve => {
            const finish = ok => {
                dialog.close();
                $('accept').onclick = null;
                $('cancel').onclick = null;
                dialog.oncancel = null;
                dialog.onclick = null;
                restoreFocus(focus);
                resolve(ok);
            };
            $('accept').onclick = () => finish(true);
            $('cancel').onclick = () => finish(false);
            dialog.onclick = event => {
                const bounds = dialog.getBoundingClientRect();

                if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) { finish(false); }
            };
            dialog.oncancel = e => {
                e.preventDefault();
                finish(false);
            };
        });
    } finally {
        stop();
        confirming = false;
    }
}

function syncRetry() {
    $('operation-bar').hidden = !pending && !$('operation').textContent;
    $('retry').hidden = !pending;
    $('retry').disabled = !pending || pendingSends.has(pending);
    $('operation').setAttribute('aria-busy', String(pendingSends.size > 0));
    syncPolicyEditors();
}

async function completePending(submitted, outcome, view = viewVersion, receipt, feedback = true) {
    // 查询与原请求可能交错完成，同一份待确认状态只消费一次。
    if (pending !== submitted || outcome === 'unknown') { return; }

    const committed = pendingCommit, affectedUsers = pendingAccounts, reasonRevision = pendingReasonRevision;
    pending = null;
    pendingCommit = null;
    pendingAccounts = undefined;
    pendingReasonRevision = undefined;

    if (val('reason') === submitted.reason && (inputRevisions.get($('reason')) || 0) === reasonRevision) {
        $('reason').value = '';
        $('reason').style.height = 'auto';
        clearFieldError($('reason'));
    }

    syncRetry();
    invalidateAdminOperations();

    if (outcome === 'committed') {
        const users = affectedUsers ?? (submitted.userId ? [submitted.userId] : submitted.action === 'compensate'
            ? [...submitted.credits, ...submitted.burns].map(item => item.userId) : undefined);

        if (['credit', 'burn', 'status', 'reverseOwn', 'compensate', 'release'].includes(submitted.action)) {
            invalidateAccount(undefined, users);
        }

        if (['credit', 'burn', 'reverseOwn', 'compensate', 'release'].includes(submitted.action)) { invalidateHistory(submitted, receipt.committedAtMs, users); }

        try { await committed?.(submitted); } catch (error) {
            if (feedback && view === viewVersion) { notice('操作已完成，页面更新失败，请手动查询', true); }
        }
    }
}

// 查询结果先校验确定状态所需字段，异常响应不能消费原请求的恢复入口。
function operationResult(data, id) {
    const result = data?.data, receipt = result?.receipt;
    const committed = result?.status === 'COMMITTED' && validReceipt(receipt, id);
    const rejected = result?.status === 'REJECTED' && pointsFailure(result.error) && result.error.retryable === false;

    if (data?.ok !== true || !result || Array.isArray(result) || (!committed && !rejected && result.status !== 'NOT_FOUND')
        || (data.reason !== undefined && data.reason !== null && typeof data.reason !== 'string')) {
        throw Error('操作查询结果不符合要求，请保留原操作编号查询或重试');
    }

    return result;
}

async function recoverPending(source, id, result) {
    if (!pending || source !== 'admin' || id !== pending.operationId) { return; }

    if (result.status === 'COMMITTED') {
        await completePending(pending, 'committed', viewVersion, result.receipt);
    } else if (result.status === 'REJECTED') {
        await completePending(pending, 'rejected');
    }
}

function actionReason() {
    if (pending) { throw Error('上次操作结果尚未确认，请先使用原编号重试或查询'); }

    const reason = required('reason', '请填写管理操作原因');

    if (reason.length > UI_LIMITS.reasonCharacters) { fieldError('reason', '管理操作原因最多 256 字符'); }

    clearFieldError($('reason'));

    return reason;
}

async function submit(body, description, committed, affectedUsers) {
    const reason = actionReason();
    // 编辑代次随原操作保留，重试不能重新认领后续输入的原因草稿。
    const reasonRevision = inputRevisions.get($('reason')) || 0;
    const payload = { ...body, reason, confirmed: true, operationId: crypto.randomUUID() };
    encodeAction(payload);
    const danger = ['burn', 'reverseOwn'].includes(body.action) || (body.action === 'compensate' && body.burns.length > 0) || (body.action === 'status' && body.status === 'suspended') || (body.action === 'source-policy' && !body.policy.enabled);

    if (!await confirm(description + '\n原因：' + reason, { danger })) { return 'cancelled'; }

    pending = payload;
    pendingCommit = committed;
    pendingAccounts = affectedUsers;
    pendingReasonRevision = reasonRevision;

    return retry();
}

function actionFields(submitted) {
    const fields = {
        credit: ['user', 'amount', 'reference'], burn: ['user', 'amount', 'reference'], status: ['user'],
        reverseOwn: ['original'], compensate: ['original', 'vectors'], release: [],
        'source-policy': ['source-id', 'source-enabled', 'permissions', 'read-balance', 'read-transactions'],
        'wallet-policy': ['wallet-enabled', 'fee-mode', ...(submitted.feeMode === 'proportional' ? ['fee-rate'] : [])]
    };

    return [...fields[submitted.action], 'reason'];
}

async function retry() {
    if (!pending || pendingSends.has(pending)) { return 'unknown'; }

    const submitted = pending, view = viewVersion;
    const current = readContext('admin-action-feedback', actionFields(submitted));
    pendingSends.add(submitted);
    syncRetry();
    $('operation').textContent = '操作编号：' + submitted.operationId;
    fillFields({ 'lookup-source': 'admin', 'lookup-id': submitted.operationId });
    let outcome = 'unknown', receipt;

    try {
        try {
            const result = await post(submitted);

            if (result.ok === false) {
                if (pending === submitted && current()) { notice(result.message + '\n操作编号：' + submitted.operationId, true); }

                if (result.retryable === false) { outcome = 'rejected'; }
            } else {
                if (!validReceipt(result.data, submitted.operationId)) { throw Error('服务回执不符合要求或与本次操作编号不一致'); }

                outcome = 'committed';
                receipt = result.data;

                if (pending === submitted && current()) { notice('操作已完成'); }
            }
        } catch (error) {
            if (pending === submitted && current()) { notice(error.message + '\n结果尚未确认，请保留原操作编号查询或重试', true); }
        }

        await completePending(submitted, outcome, view, receipt, current());

        return outcome;
    } finally {
        pendingSends.delete(submitted);
        syncRetry();
    }
}

on('retry', retry);
`;
