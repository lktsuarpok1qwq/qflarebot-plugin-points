import type { AccountRow, Entry, FundRow, Plan, ReservationRow, Snapshot } from '../model.js';
import type { Input } from '../input.js';
import { minor, safeMinor, sumMinor } from '../amounts.js';
import { requireCondition } from '../errors.js';
import { identifier } from './operations.js';
import { LIMITS } from '../limits.js';

export class LedgerPlan {
    readonly data: Plan = {
        type: 'mint', entries: [], accounts: [], funds: [],
        conditions: [], reservationIds: []
    };
    minted = 0;
    burned = 0;
    reversalMint = 0;
    reversalBurn = 0;
    transferred = 0;
    constructor(readonly snapshot: Snapshot, readonly input: Input) {
    }

    amount(value: unknown, zero = false): number {
        const result = minor(value, zero);
        requireCondition(result <= LIMITS.amountMinor, 'LIMIT_EXCEEDED');

        return result;
    }

    enabledSource() {
        const source = this.snapshot.source;
        requireCondition(source, 'SOURCE_NOT_REGISTERED');
        requireCondition(source.enabled === 1, 'SOURCE_DISABLED');

        return source;
    }

    permission(permission: string): void {
        const source = this.enabledSource();
        requireCondition((JSON.parse(source.operation_permissions) as string[]).includes(permission), 'SOURCE_NOT_ALLOWED');
    }

    recovery(row: ReservationRow, permission: string): void {
        requireCondition(this.input.source === 'admin' || this.input.source === 'points.system' || (JSON.parse(row.recovery_permissions) as string[]).includes(permission), 'SOURCE_NOT_ALLOWED');
    }

    account(userId: unknown): AccountRow {
        const id = identifier(userId);
        let account = this.data.accounts.find(row => row.user_id === id);

        if (account) {
            return account;
        }

        const existing = this.snapshot.accounts.find(row => row.user_id === id);
        requireCondition(existing, 'ACCOUNT_NOT_FOUND');
        account = { ...existing, version: existing.version + 1, updated_at_ms: 0 };
        requireCondition(Number.isSafeInteger(account.version), 'LIMIT_EXCEEDED');
        this.data.accounts.push(account);

        return account;
    }

    entry(account: string, bucket: Entry['bucket'], delta: number, reference?: {
        reservationId?: string;
    }): void {
        requireCondition(Number.isSafeInteger(delta), 'LIMIT_EXCEEDED');

        if (delta !== 0) {
            this.data.entries.push({ accountId: account, bucket, deltaMinor: delta, ...reference });
        }
    }

    move(account: AccountRow, bucket: 'available' | 'reserved', delta: number, reference?: {
        reservationId?: string;
    }): void {
        const field = bucket === 'available' ? 'available_minor' : 'reserved_minor';
        const next = safeMinor(BigInt(account[field]) + BigInt(delta));
        requireCondition(next >= 0, 'INSUFFICIENT_BALANCE');
        account[field] = next;
        this.entry(account.user_id, bucket, delta, reference);
    }

    spend(account: AccountRow): void {
        requireCondition(this.input.source === 'admin' || account.status === 'active', 'ACCOUNT_SUSPENDED');
    }

    newDeadline(expiresAt: unknown): number {
        const expiry = minor(expiresAt);
        this.data.conditions.push({ sql: '? <= decision_at_ms', params: [expiry], error: 'RESERVATION_EXPIRED' }, { sql: '? > decision_at_ms + ?', params: [expiry, LIMITS.reservationWindowMs], error: 'LIMIT_EXCEEDED' });

        return expiry;
    }

    active(row: ReservationRow, unexpired: boolean): void {
        requireCondition(row.status === 'active', 'RESERVATION_CONFLICT');

        if (unexpired) {
            this.data.conditions.push({ sql: '? <= decision_at_ms', params: [row.expires_at_ms], error: 'RESERVATION_EXPIRED' });
        }
    }

    freshReservation(expiresAt: unknown): ReservationRow {
        identifier(this.input.referenceId);

        return {
            bot_id: this.snapshot.bot, source: this.input.source, reference_id: this.input.referenceId!,
            amount_minor: 0, status: 'active', created_at_ms: 0, expires_at_ms: this.newDeadline(expiresAt),
            renewed_at_ms: null, renewal_deadline_ms: 0, policy_version: this.snapshot.source!.policy_version,
            recovery_permissions: this.snapshot.source!.operation_permissions,
            created_operation_id: this.input.operationId, last_operation_id: this.input.operationId,
            last_operation_source: this.input.source, terminal_operation_id: null, terminal_operation_source: null, consumed_tx_id: null
        };
    }

    fund(id: unknown): FundRow {
        const row = this.snapshot.funds.find(item => item.reservation_id === id);
        requireCondition(row, 'RESERVATION_NOT_FOUND');
        const copy = { ...row };
        this.data.funds.push(copy);

        return copy;
    }

    terminate(row: ReservationRow, status: ReservationRow['status']): void {
        row.status = status;
        row.last_operation_id = this.input.operationId;
        row.last_operation_source = this.input.source;
        row.terminal_operation_id = this.input.operationId;
        row.terminal_operation_source = this.input.source;
    }

    finish(): Plan {
        requireCondition(this.data.accounts.length <= LIMITS.accounts && this.data.entries.length <= LIMITS.entries, 'LIMIT_EXCEEDED');
        requireCondition(this.data.funds.length <= LIMITS.reservations, 'LIMIT_EXCEEDED');
        requireCondition(sumMinor(this.data.entries.map(entry => entry.deltaMinor)) === 0, 'INVALID_SETTLEMENT');

        for (const account of this.data.accounts) {
            sumMinor([account.available_minor, account.reserved_minor]);
        }

        return this.data;
    }
}
