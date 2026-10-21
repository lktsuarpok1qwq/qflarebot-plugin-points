import type { PointsBalance, PointsErrorCode, TransactionSummary } from '../contracts.js';

export interface AccountRow {
    bot_id: string;
    user_id: string;
    available_minor: number;
    reserved_minor: number;
    status: 'active' | 'suspended';
    version: number;
    created_at_ms: number;
    updated_at_ms: number;
}
export interface SourceRow {
    bot_id: string;
    source: string;
    enabled: number;
    operation_permissions: string;
    read_permissions: string;
    policy_version: number;
}
export interface ReservationRow {
    bot_id: string;
    source: string;
    reference_id: string;
    amount_minor: number;
    status: 'active' | 'released' | 'consumed' | 'expired';
    created_at_ms: number;
    expires_at_ms: number;
    renewed_at_ms: number | null;
    renewal_deadline_ms: number;
    policy_version: number;
    recovery_permissions: string;
    created_operation_id: string;
    last_operation_id: string;
    last_operation_source: string;
    terminal_operation_id: string | null;
    terminal_operation_source: string | null;
    consumed_tx_id: string | null;
}
export interface FundRow extends ReservationRow {
    reservation_id: string;
    user_id: string;
}
export interface Entry {
    accountId: string;
    bucket: 'available' | 'reserved' | 'supply';
    deltaMinor: number;
    reservationId?: string;
}
export interface TransactionRow {
    tx_id: string;
    bot_id: string;
    source: string;
    operation_id: string;
    type: TransactionSummary['type'];
    reference_id: string | null;
    reverses_tx_id: string | null;
    compensates_tx_id: string | null;
    created_at_ms: number;
    date_bjt: string;
    month_bjt: string;
    commit_revision: number;
    ledger_json: string;
    expected_entry_count: number;
    reason: string | null;
}
export interface Snapshot {
    bot: string;
    now: number;
    revision: number;
    source: SourceRow | null;
    accounts: AccountRow[];
    funds: FundRow[];
    original: TransactionRow | null;
    reversed: boolean;
}
export interface TimeCondition {
    sql: string;
    params: unknown[];
    error: PointsErrorCode;
}
export interface Plan {
    type: TransactionSummary['type'];
    entries: Entry[];
    accounts: AccountRow[];
    funds: FundRow[];
    conditions: TimeCondition[];
    reservationIds: string[];
    reversal?: string;
    compensation?: string;
    renewal?: FundRow;
    notBeforeMs?: number;
    walletPolicy?: { enabled: boolean; feeMode: 'free' | 'proportional'; numerator: number; denominator: number };
}

export function balance(row: AccountRow): PointsBalance {
    return {
        userId: row.user_id, availableMinor: row.available_minor, reservedMinor: row.reserved_minor,
        totalMinor: row.available_minor + row.reserved_minor, status: row.status
    };
}
