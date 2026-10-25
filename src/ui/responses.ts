// 管理页只校验当前展示和操作所需的响应字段，不替代服务端资金与权限守卫。
export const RESPONSE_SCRIPT = String.raw`
const responseObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const responseInteger = value => Number.isSafeInteger(value) && value >= 0;
const responseId = value => typeof value === 'string' && value.length > 0 && value.length <= UI_LIMITS.idCharacters && !/[\s\x00-\x1f\x7f]/u.test(value);
const responseNullableId = value => value == null || responseId(value);
const responseText = value => value == null || typeof value === 'string';
const responseCursor = value => value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 2048);
const responseTypes = Object.keys(transactionNames);

function validReceipt(receipt, id) {
    return responseObject(receipt) && receipt.operationId === id && responseInteger(receipt.committedAtMs);
}

function responsePermissions(text, allowed) {
    if (typeof text !== 'string') { return false; }

    try {
        const values = JSON.parse(text);

        return Array.isArray(values) && new Set(values).size === values.length && values.every(value => allowed.includes(value));
    } catch { return false; }
}

function responseReservation(row) {
    return responseObject(row) && responseId(row.source) && responseId(row.reservation_id) && responseId(row.user_id)
        && ['active', 'released', 'consumed', 'expired'].includes(row.status) && responseInteger(row.amount_minor) && row.amount_minor > 0
        && responseInteger(row.expires_at_ms) && responseInteger(row.observed_at_ms) && responseNullableId(row.reference_id);
}

function responseHistoryRow(row) {
    return responseObject(row) && responseId(row.tx_id) && responseId(row.source) && responseTypes.includes(row.type)
        && responseInteger(row.created_at_ms) && responseText(row.reason) && ['loaded', 'unavailable'].includes(row.bodyStatus)
        && Array.isArray(row.entries) && row.entries.length <= UI_LIMITS.entries
        && (row.bodyStatus !== 'loaded' || row.entries.length > 0) && row.entries.every(entry => responseObject(entry)
            && responseId(entry.account_id) && ['available', 'reserved', 'supply'].includes(entry.bucket)
            && Number.isSafeInteger(entry.delta_minor) && entry.delta_minor !== 0);
}

function checkedState(kind, params, data) {
    // 模板、QQ 绑定和操作查询在各自入口校验，避免重复执行同一套检查。
    let valid = true;

    switch (kind) {
        case 'account':
            valid = data === null || (responseObject(data) && data.user_id === params.user && responseId(data.user_id)
                && responseInteger(data.available_minor) && responseInteger(data.reserved_minor) && ['active', 'suspended'].includes(data.status));
            break;
        case 'policy':
            valid = responseObject(data) && [0, 1].includes(data.qq_transfer_enabled) && ['free', 'proportional'].includes(data.qq_fee_mode)
                && responseInteger(data.qq_fee_numerator) && responseInteger(data.qq_fee_denominator) && data.qq_fee_denominator > 0
                && responseInteger(data.policy_version);
            break;
        case 'sources':
            valid = Array.isArray(data) && data.length <= 50 && data.every(row => responseObject(row) && responseId(row.source)
                && [0, 1].includes(row.enabled) && responseInteger(row.policy_version)
                && responsePermissions(row.operation_permissions, Object.keys(permissionNames)) && responsePermissions(row.read_permissions, ['balance', 'transactions']));
            break;
        case 'funds':
            valid = responseObject(data) && responseCursor(data.nextCursor) && Array.isArray(data.items) && data.items.length <= 15
                && data.items.every(row => responseReservation(row) && row.status === 'active');
            break;
        case 'fund':
            valid = data === null || (responseReservation(data) && data.source === params.source && data.reservation_id === params.id);
            break;
        case 'admin-operations':
            valid = responseObject(data) && responseCursor(data.nextCursor) && Array.isArray(data.items) && data.items.length <= 15
                && data.items.every(row => responseObject(row) && responseId(row.operation_id) && responseInteger(row.created_at_ms)
                    && ['committed', 'rejected'].includes(row.status) && responseText(row.reason));
            break;
        case 'transaction':
            valid = responseObject(data) && data.tx_id === params.id && responseId(data.tx_id) && responseTypes.includes(data.type)
                && responseNullableId(data.reversal_tx_id) && responseNullableId(data.reference_id)
                && responseObject(data.ledger) && Array.isArray(data.ledger.entries) && data.ledger.entries.length > 0
                && data.ledger.entries.length <= UI_LIMITS.entries && data.ledger.entries.every(entry => responseObject(entry)
                    && responseId(entry.accountId) && ['available', 'reserved', 'supply'].includes(entry.bucket)
                    && Number.isSafeInteger(entry.deltaMinor) && entry.deltaMinor !== 0);
            break;
        case 'history':
        case 'history-export':
            valid = responseObject(data) && data.month === params.month && responseInteger(data.highWaterRevision)
                && typeof data.bodyComplete === 'boolean' && responseCursor(data.nextCursor) && Array.isArray(data.items)
                && data.items.length <= (kind === 'history' ? 8 : 50) && data.items.every(row => responseHistoryRow(row)
                    && (!params.source || row.source === params.source)) && data.bodyComplete === data.items.every(row => row.bodyStatus === 'loaded')
                && responseObject(data.pageTotals) && ['minted', 'burned', 'transferred', 'reversalMint', 'reversalBurn'].every(name => typeof data.pageTotals[name] === 'string' && /^\d+$/.test(data.pageTotals[name]));

            if (data.scanLimited !== undefined) {
                valid = valid && data.scanLimited === true && kind === 'history' && !!params.user && !!params.source && !!data.nextCursor;
            }

            if (kind === 'history-export') { valid = valid && data.format === 'points.monthly-ledger/v1' && responseId(data.botId); }

            break;
    }

    if (!valid) { throw Error('查询响应不符合要求，请重新查询'); }

    return data;
}
`;
