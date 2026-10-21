import type { PointsErrorCode, PointsFailure, Result } from '../contracts.js';

const MESSAGES: Record<PointsErrorCode, string> = {
    INVALID_ARGUMENT: '参数不符合要求', INVALID_ACCOUNT: '账户标识无效', ACCOUNT_NOT_FOUND: '账户尚未开户，请账户本人私聊机器人发送 /积分 开户',
    ACCOUNT_SUSPENDED: '账户已暂停主动支出', INSUFFICIENT_BALANCE: '可用余额不足',
    SOURCE_NOT_REGISTERED: '来源尚未登记', SOURCE_NOT_ALLOWED: '来源没有此操作权限', SOURCE_DISABLED: '来源已停用',
    POLICY_VERSION_CONFLICT: '设置已更新，请刷新后重新提交', OPERATION_CONFLICT: '操作编号已用于不同请求',
    OPERATION_REJECTED: '操作已被拒绝', OPERATION_PENDING: '结果尚未确认，请使用原操作编号查询或重试',
    RESERVATION_NOT_FOUND: '预留不存在', RESERVATION_EXPIRED: '预留已到期', RESERVATION_CONFLICT: '预留状态不允许此操作',
    INVALID_SETTLEMENT: '结算金额或业务关联不符合要求', TRANSFER_DISABLED: 'QQ 主动转账已关闭',
    CONFIRMATION_EXPIRED: '转账确认已过期', CONFIRMATION_CANCELLED: '转账已取消',
    REVERSAL_NOT_SUPPORTED: '该交易不支持完整冲正', ALREADY_REVERSED: '该交易已完整冲正',
    TRANSACTION_NOT_FOUND: '原交易不存在', LIMIT_EXCEEDED: '超过单次操作限制',
    BUSY: '状态正在变化，请使用原操作编号重试',
    INTERNAL_ERROR: '服务暂不可用，请使用原操作编号查询或重试'
};

export function failure(code: PointsErrorCode, retryable = false): PointsFailure {
    return { ok: false, code, message: MESSAGES[code], retryable };
}

export function success<T>(data: T): Result<T> {
    return { ok: true, data };
}

export class PointsFault extends Error {
    constructor(readonly code: PointsErrorCode, readonly retryable = false) {
        super(MESSAGES[code]);
    }
}

export function requireCondition(condition: unknown, code: PointsErrorCode): asserts condition {
    if (!condition) {
        throw new PointsFault(code);
    }
}

export function systemFailure(error: unknown): PointsFailure {
    return error instanceof PointsFault ? failure(error.code, error.retryable || error.code === 'INTERNAL_ERROR') : failure('INTERNAL_ERROR', true);
}
