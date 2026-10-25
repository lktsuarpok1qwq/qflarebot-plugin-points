export type SourceId = string;
export type OperationId = string;
export type AccountId = string;
export type Minor = number; // 安全整数；正数/非负数依各字段规则验证
export type PointsErrorCode = 'INVALID_ARGUMENT' | 'INVALID_ACCOUNT' | 'ACCOUNT_NOT_FOUND' | 'ACCOUNT_SUSPENDED' | 'INSUFFICIENT_BALANCE' | 'SOURCE_NOT_REGISTERED' | 'SOURCE_NOT_ALLOWED' | 'SOURCE_DISABLED' | 'POLICY_VERSION_CONFLICT' | 'OPERATION_CONFLICT' | 'OPERATION_REJECTED' | 'OPERATION_PENDING' | 'RESERVATION_NOT_FOUND' | 'RESERVATION_EXPIRED' | 'RESERVATION_CONFLICT' | 'INVALID_SETTLEMENT' | 'TRANSFER_DISABLED' | 'CONFIRMATION_EXPIRED' | 'CONFIRMATION_CANCELLED' | 'REVERSAL_NOT_SUPPORTED' | 'ALREADY_REVERSED' | 'TRANSACTION_NOT_FOUND' | 'LIMIT_EXCEEDED' | 'BUSY' | 'INTERNAL_ERROR';
export type PointsFailure = {
    ok: false;
    code: PointsErrorCode;
    message: string;
    retryable: boolean;
};
export type Result<T> = {
    ok: true;
    data: T;
} | PointsFailure;
export interface PointsBalance {
    userId: AccountId;
    availableMinor: Minor;
    reservedMinor: Minor;
    totalMinor: Minor;
    status: 'active' | 'suspended';
}
export interface OperationContext {
    source: SourceId;
    operationId: OperationId;
    referenceId?: string;
    reason?: string;
}
// 预留与结算必须关联同一业务实体；不携带玩法、赔率或比赛详情。
export type ReservationContext = OperationContext & {
    referenceId: string;
};
export interface OperationReceipt {
    operationId: OperationId;
    committedAtMs: number;
    transactionId?: string; // 无资产分录的操作可没有交易 ID
    reservationIds?: string[];
    balancesAtCommit?: PointsBalance[]; // 可选的原交易快照，不代表查询时余额
}
export type OperationLookup = {
    status: 'NOT_FOUND';
} | {
    status: 'COMMITTED';
    receipt: OperationReceipt;
} | {
    status: 'REJECTED';
    error: PointsFailure & {
        retryable: false;
    };
};
// status 是已持久化状态；过期扫描之前可能仍为 active，必须同时检查 effectiveActive。
export interface ReservationState {
    referenceId: string;
    amountMinor: Minor;
    status: 'active' | 'released' | 'consumed' | 'expired';
    expiresAtMs: number;
    effectiveActive: boolean; // status=active 且 expiresAtMs > 本次 observedAtMs
    createdOperationId: OperationId;
    lastOperationId: OperationId;
    lastOperationSource: SourceId;
    terminalOperationId?: OperationId;
    terminalOperationSource?: SourceId;
    terminalTransactionId?: string;
}
export interface FundReservationState extends ReservationState {
    userId: AccountId;
}
export interface ReservationSnapshot {
    observedAtMs: number;
    funds: Array<{
        reservationId: string;
        record: FundReservationState | null;
    }>;
}
export interface TransactionSummary {
    transactionId: string;
    source: SourceId;
    operationId: OperationId;
    type: 'mint' | 'burn' | 'transfer' | 'reserve' | 'release' | 'settle' | 'reverse' | 'compensate';
    referenceId?: string;
    reason?: string;
    reversesTransactionId?: string;
    compensatesTransactionId?: string;
    createdAtMs: number;
    availableDeltaMinor: Minor; // 查询用户的有符号净变化
    reservedDeltaMinor: Minor;
}
export interface TransactionPage {
    month: string;
    items: TransactionSummary[];
    nextCursor?: string;
}
export interface AccountCredit {
    userId: AccountId;
    amountMinor: Minor; // 正整数；已有账户
}
export interface SettlementInput extends ReservationContext {
    funds: Array<{
        reservationId: string;
        payouts: AccountCredit[];
        burnMinor: Minor; // 非负整数；该笔本金全部用于 payouts + burn
    }>;
    rewards: AccountCredit[]; // 本次直接发行的奖励；与本金分配原子提交
}
export type SourcePolicySnapshot = { source: SourceId; registered: false } | {
    source: SourceId; registered: true; enabled: boolean;
    operationPermissions: string[]; readPermissions: string[]; policyVersion: number;
};
export interface AccountCheck {
    accounts: Array<{ userId: AccountId; exists: boolean }>;
    // 仅在存在未开户用户时返回，不包含余额或账户状态。
    openingHint?: string;
}
export interface PointsService {
    getSourcePolicy(input: { source: SourceId }): Promise<Result<SourcePolicySnapshot>>;
    // 只读；已登记且启用的来源可调用，不另设权限开关。
    checkAccounts(input: { source: SourceId; userIds: AccountId[] }): Promise<Result<AccountCheck>>;
    // 自然键幂等登记；成功只表示来源已存在，不代表启用或获得权限。
    registerSource(input: {
        source: SourceId;
    }): Promise<Result<{ source: SourceId }>>;
    getBalance(input: {
        source: SourceId;
        userId: AccountId;
    }): Promise<Result<PointsBalance>>;
    getTransactions(input: {
        source: SourceId;
        userId: AccountId;
        month?: string;
        limit?: number;
        cursor?: string;
    }): Promise<Result<TransactionPage>>;
    getOperation(input: {
        source: SourceId;
        operationId: OperationId;
    }): Promise<Result<OperationLookup>>;
    getReservations(input: {
        source: SourceId;
        reservationIds: string[];
    }): Promise<Result<ReservationSnapshot>>;
    credit(input: OperationContext & {
        userId: AccountId;
        amountMinor: Minor;
    }): Promise<Result<OperationReceipt>>;
    // retryable=false 的余额不足、账户不存在/暂停、来源不存在/停用均已保存永久拒绝。
    // 此保证仅适用于 burn；参数、权限歧义、编号冲突和未知结果仍须按原编号核验。
    burn(input: OperationContext & {
        userId: AccountId;
        amountMinor: Minor;
    }): Promise<Result<OperationReceipt>>;
    transfer(input: OperationContext & {
        fromUserId: AccountId;
        toUserId: AccountId;
        amountMinor: Minor;
        feeMinor?: Minor;
    }): Promise<Result<OperationReceipt>>;
    reserve(input: ReservationContext & {
        userId: AccountId;
        reservationId: string;
        amountMinor: Minor;
        expiresAtMs: number;
    }): Promise<Result<OperationReceipt>>;
    renewReservation(input: OperationContext & {
        reservationId: string;
        expiresAtMs: number;
    }): Promise<Result<OperationReceipt>>;
    release(input: OperationContext & {
        reservationId: string;
    }): Promise<Result<OperationReceipt>>;
    reserveBundle(input: ReservationContext & {
        expiresAtMs: number;
        funds: Array<{
            userId: AccountId;
            reservationId: string;
            amountMinor: Minor;
        }>;
    }): Promise<Result<OperationReceipt>>;
    reverseOwn(input: OperationContext & {
        originalTransactionId: string;
    }): Promise<Result<OperationReceipt>>;
    settle(input: SettlementInput): Promise<Result<OperationReceipt>>;
}
