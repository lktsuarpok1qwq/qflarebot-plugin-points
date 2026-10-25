// 预留列表、指定查询、释放和到期维护的页面交互，不改变资金接口。
export const RESERVATION_SCRIPT = String.raw`
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
    $('reserve-next').textContent = '下一页';
    $('reserve-load').textContent = '重新加载';
    $('reserve-result').textContent = '预留状态可能已变化，请点击重新加载查看';
    syncReservationReason();
}

async function loadReservations(cursor) {
    if (reserveReading) { return; }

    reserveReading = true;
    clearDetail();

    if (!cursor) {
        reserveCursor = undefined;
        $('reserve-next').textContent = '下一页';
    }

    $('reserve-load').disabled = true;
    $('reserve-next').disabled = true;

    try {
        const displayed = await readView('funds', cursor ? { cursor } : {}, data => {
            reserveCursor = data.nextCursor;
            $('reserve-next').textContent = '下一页';
            $('reserve-load').textContent = '重新加载';
            showReservations('reserve-result', data.items);
        }, [], 'reserve-result');

        if (!displayed) { reserveCursor = undefined; }
    } catch (error) {
        if (cursor && reserveCursor) { $('reserve-next').textContent = '重试下一页'; }

        throw error;
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
    const request = detailRequest, trigger = $('reserve-find'), focus = detailFocusContext();
    const source = identifierField('reserve-source', '请填写来源'), id = identifierField('reserve-id', '请填写预留 ID');
    await readView('fund', { source, id }, row => {
        if (request === detailRequest) { showDetail('预留详情', () => showReservations('detail-content', row ? [row] : []), trigger, 'fund', focus); }
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
`;
