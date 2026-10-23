// 管理操作列表、个人流水与手动月度导出，复用页面的查询和反馈工具。
export const HISTORY_SCRIPT = String.raw`
let operationsReading = false, historyReading = false, operationsLoaded = false, historyLoaded = false;

function invalidateAdminOperations() {
    if (!operationsLoaded && !operationsReading && !operationsCursor) { return; }

    operationsLoaded = false;
    operationsCursor = undefined;
    readVersions.set('admin-operations', (readVersions.get('admin-operations') || 0) + 1);
    $('operations-next').disabled = true;
    $('operations-result').removeAttribute('aria-busy');
    $('operations-result').textContent = '管理记录可能已变化，请点击查询最近操作重新查询';
}

function invalidateHistory(submitted, committedAtMs, users) {
    if ((!historyLoaded && !historyReading && !historyCursor) || !historyFilters) { return; }

    if (submitted) {
        const timestamp = new Date(committedAtMs + 8 * 3600000);
        const month = Number.isFinite(timestamp.getTime()) ? timestamp.toISOString().slice(0, 7) : null;

        if ((month && historyFilters.month !== month) || (historyFilters.source && historyFilters.source !== 'admin')) { return; }

        if (users && historyFilters.user && !users.includes(historyFilters.user)) { return; }
    }

    historyLoaded = false;
    historyRequest++;
    readVersions.set('history', (readVersions.get('history') || 0) + 1);
    historyFilters = undefined;
    historyCursor = undefined;
    $('history-next').disabled = true;
    $('history-result').removeAttribute('aria-busy');
    $('history-scope').textContent = '交易记录可能已变化，请重新查询';
    $('history-result').replaceChildren();
}

const loadAdminOperations = async (next = false) => {
    if (operationsReading) { return; }

    operationsReading = true;
    operationsLoaded = false;

    if (!next) { operationsCursor = undefined; }

    clearDetail();
    $('operations-load').disabled = true;
    $('operations-next').disabled = true;

    try {
        const displayed = await readView('admin-operations', next && operationsCursor ? { cursor: operationsCursor } : {}, data => {
            operationsLoaded = true;
            operationsCursor = data.nextCursor;
            table('operations-result', [['时间', r => date(r.created_at_ms)], ['操作编号', r => r.operation_id], ['原因', r => r.reason], ['结果', r => r.status === 'committed' ? '已完成' : '已拒绝']], data.items, (r, td) => rowButton(td, '查看结果', async () => {
                fillFields({ 'lookup-source': 'admin', 'lookup-id': r.operation_id });
                await loadOperationResult('admin', r.operation_id);
            }));
        }, [], 'operations-result');

        if (!displayed) { operationsCursor = undefined; }
    } finally {
        operationsReading = false;
        $('operations-load').disabled = false;
        $('operations-next').disabled = !operationsCursor;
    }
};

on('operations-load', () => loadAdminOperations());
on('operations-next', () => loadAdminOperations(true));
$('month').value = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);

for (const id of ['month', 'history-user', 'history-source']) {
    $(id).addEventListener('input', () => {
        historyLoaded = false;
        historyRequest++;
        historyCursor = undefined;
        $('history-next').disabled = true;
        $('history-scope').textContent = '筛选条件已修改，请重新查询';
        $('history-result').replaceChildren();
        clearDetail();
    });
}

function personalDelta(row, user, bucket) {
    if (row.bodyStatus !== 'loaded') {
        return '不可用';
    }

    const delta = row.entries.reduce((sum, entry) => entry.account_id === user && entry.bucket === bucket ? sum + BigInt(entry.delta_minor) : sum, 0n);

    return (delta > 0n ? '+' : '') + money(delta);
}

async function loadHistory(next = false) {
    if (historyReading) { return; }

    if (!next) {
        monthField();
        identifierField('history-user', '', true);
        identifierField('history-source', '', true);
    }

    historyReading = true;
    historyLoaded = false;
    $('history-load').disabled = true;

    clearDetail();
    const request = ++historyRequest, current = readContext('history', ['month', 'history-user', 'history-source']);

    if (!next) {
        historyFilters = { month: val('month'), user: val('history-user'), source: val('history-source') };
        historyCursor = undefined;
    }

    const filters = { ...historyFilters }, cursor = historyCursor;
    $('history-next').disabled = true;
    loadingRows($('history-result'));
    $('history-result').setAttribute('aria-busy', 'true');
    $('history-scope').textContent = '正在查询…';

    try {
        const data = await get('history', { ...filters, ...(next && cursor ? { cursor } : {}) });

        // 筛选或区域变化后，不让较慢的旧响应恢复失效结果。
        if (request !== historyRequest || !current()) {
            return;
        }

        historyCursor = data.nextCursor;
        $('history-next').textContent = data.scanLimited ? '继续查询' : '下一页';
        historyLoaded = true;
        $('history-scope').textContent = filters.month + (filters.user ? ' · 账户 ' + filters.user : '') + (filters.source ? ' · 来源 ' + filters.source : '') + '；' + (data.bodyComplete ? '本页正文已加载' : '本页有缺失或损坏的正文，不能视为完整结果');

        if (filters.user) {
            $('history-scope').textContent += '。金额为本账户在每笔交易中的净变动，含手续费；正数增加，负数减少，零表示无净变动。不是交易后余额。';
        } else {
            $('history-scope').textContent += '\n' + (data.bodyComplete ? '本页所列交易合计：发行 ' : '仅正文完整交易的小计：发行 ') + money(data.pageTotals.minted) + '，销毁 ' + money(data.pageTotals.burned) + '，转移 ' + money(data.pageTotals.transferred) + '，冲正发行 ' + money(data.pageTotals.reversalMint) + '，冲正销毁 ' + money(data.pageTotals.reversalBurn) + '（非全月总额）';
        }

        if (data.scanLimited) { $('history-scope').textContent += '\n已查询一批记录，可点击“继续查询”查找更早记录'; }

        const columns = [['时间', r => date(r.created_at_ms)], ['类型', r => transactionType(r.type)]];

        if (filters.user) {
            columns.push(['可用变动', r => personalDelta(r, filters.user, 'available')], ['冻结变动', r => personalDelta(r, filters.user, 'reserved')]);
        }

        columns.push(['来源', r => r.source], ['交易编号', r => r.tx_id], ['原因', r => r.reason], ['正文', r => r.bodyStatus === 'loaded' ? '已加载' : '不可用']);
        table('history-result', columns, data.items, (r, td) => rowButton(td, '查看 / 纠错', async () => {
            if (val('original') !== r.tx_id) {
                const dirty = val('original') || [...$('vectors').querySelectorAll('input')].some(input => input.value.trim());

                if (dirty && !await confirm('切换到交易 ' + r.tx_id + '，并清空已有补偿项？', { title: '切换纠错交易', accept: '切换并清空补偿项' })) { return; }

                $('vectors').replaceChildren();
                syncVectorButtons();
            }

            fillFields({ original: r.tx_id });
            $('correction-panel').open = true;
            syncReason();
            showJsonDetail('交易详情', { 交易: r.tx_id, 分录: r.entries, 冲正原交易: r.reverses_tx_id, 补偿原交易: r.compensates_tx_id }, $('original'), 'transaction');
        }));

        if (data.scanLimited && !data.items.length) {
            const hint = document.createElement('p');
            hint.className = 'hint';
            hint.textContent = '本批未找到匹配记录，可继续查询';
            $('history-result').replaceChildren(hint);
        }
    } catch (error) {
        if (request === historyRequest && current()) {
            $('history-scope').textContent = '查询失败，请重试；未取得本页流水';
            throw error;
        }
    } finally {
        historyReading = false;
        $('history-load').disabled = false;
        $('history-result').removeAttribute('aria-busy');

        if ($('history-result').querySelector('.loading-rows')) { $('history-result').replaceChildren(); }

        if ($('history-scope').textContent === '正在查询…') { $('history-scope').textContent = '查询条件已变化，请重新查询'; }

        if (request === historyRequest) {
            $('history-next').disabled = !historyCursor;
        }
    }
}

on('history-load', () => loadHistory());
on('history-next', () => loadHistory(true));
let exportCancelled = false;
on('export-cancel', () => {
    exportCancelled = true;
    $('export-status').textContent = '正在取消，当前页返回后停止…';
});
on('history-export', async () => {
    const month = monthField(), transactions = [], seen = new Set();
    const current = readContext('history-export', ['month']);
    let first, cursor, entryCount = 0;
    exportCancelled = false;
    $('export-cancel').hidden = false;
    $('export-status').textContent = '正在导出 ' + month + ' 的全部流水…';

    try {
        do {
            const page = await get('history-export', { month, ...(cursor ? { cursor } : {}) });

            if (exportCancelled) {
                if (current()) { notice('已取消导出，未生成文件'); }

                return;
            }

            first ??= page;

            if (page.botId !== first.botId || page.month !== month || page.format !== first.format || page.highWaterRevision !== first.highWaterRevision) {
                throw Error('导出范围不一致，请重新导出');
            }

            if (!page.bodyComplete) {
                throw Error('存在缺失或损坏的交易正文，请检查流水后重新导出');
            }

            for (const row of page.items) {
                if (seen.has(row.tx_id)) {
                    throw Error('导出出现重复交易，请重新导出');
                }

                seen.add(row.tx_id);
                transactions.push(row);
                entryCount += row.entries.length;
            }

            if (page.nextCursor && (!page.items.length || page.nextCursor === cursor)) {
                throw Error('导出分页未推进，请重新导出');
            }

            cursor = page.nextCursor;
            $('export-status').textContent = '正在导出 ' + month + '，已读取 ' + transactions.length + ' 笔交易…';
        } while (cursor);

        const file = {
            format: first.format, botId: first.botId, month, timezone: 'Asia/Shanghai', minorPerPoint: 100,
            exportedAt: new Date().toISOString(), highWaterRevision: first.highWaterRevision,
            complete: true, transactionCount: transactions.length, entryCount, transactions
        };
        const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'points-' + month + '.json';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        if (current()) { notice('已生成 ' + month + ' 的下载文件：' + transactions.length + ' 笔交易、' + entryCount + ' 条分录'); }
    } catch (error) {
        if (current()) { notice(exportCancelled ? '已取消导出，未生成文件' : '导出失败，未生成文件：' + (error.message || String(error)), !exportCancelled); }
    } finally {
        $('export-cancel').hidden = true;
        $('export-status').textContent = '';
    }
});
`;
