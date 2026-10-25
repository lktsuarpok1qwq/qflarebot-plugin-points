// 详情的展示、失效与焦点生命周期，按页面原顺序内联执行。
export const DETAIL_SCRIPT = String.raw`
let detailRequest = 0, detailTrigger = null, detailKind = null;
let detailFocusVersion = 0;
document.addEventListener('focusin', () => { detailFocusVersion++; });
window.addEventListener('blur', () => { detailFocusVersion++; });

function detailFocusContext() {
    const version = detailFocusVersion;

    return () => version === detailFocusVersion && document.hasFocus();
}

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

function showDetail(title, render, trigger = document.activeElement, kind = null, focus = () => true) {
    const focusDetail = focus();
    clearDetail();
    detailKind = kind;
    detailTrigger = trigger;
    $('detail-title').textContent = title;
    render();
    $('detail').hidden = false;
    syncReservationReason();

    if (focusDetail) {
        $('detail-title').focus({ preventScroll: true });
        $('detail').scrollIntoView({ block: 'nearest' });
    }
}

function showJsonDetail(title, data, trigger, kind, focus) {
    showDetail(title, () => {
        const text = document.createElement('pre');
        text.textContent = JSON.stringify(data, null, 2);
        $('detail-content').append(text);
    }, trigger, kind, focus);
}

on('detail-close', () => {
    const trigger = detailTrigger;
    clearDetail();

    if (trigger?.getClientRects().length) { trigger.focus(); } else { tabs.find(tab => tab.getAttribute('aria-selected') === 'true')?.focus(); }
});
`;
