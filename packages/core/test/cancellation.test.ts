import { describe, expect, it } from 'vitest';
import { assertCancellationWindow, fullRefundAmount, restockDeltas } from '../src/index.js';

describe('pre-dispatch cancellation policy', () => {
  const base = { lifecycleStatus: 'ACTIVE' as const, paymentStatus: 'PAYMENT_VERIFIED' as const, suborderStatuses: ['PENDING_VENDOR'], hasDispatchRun: false };
  it('allows full cancellation only before preparation/dispatch, including vendor-rejected suborders', () => {
    expect(() => assertCancellationWindow(base)).not.toThrow();
    expect(() => assertCancellationWindow({ ...base, suborderStatuses: ['PENDING_VENDOR', 'REJECTED'] })).not.toThrow();
    for (const status of ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'FULFILLING', 'DELIVERED', 'COMPLETED', 'CANCELLED']) {
      expect(() => assertCancellationWindow({ ...base, suborderStatuses: [status] })).toThrow('CANCELLATION_WINDOW_CLOSED');
    }
    expect(() => assertCancellationWindow({ ...base, hasDispatchRun: true })).toThrow('CANCELLATION_WINDOW_CLOSED');
    expect(() => assertCancellationWindow({ ...base, suborderStatuses: [] })).toThrow('CANCELLATION_WINDOW_CLOSED');
  });
  it('blocks unresolved online payment and already-cancelled orders', () => {
    expect(() => assertCancellationWindow({ ...base, paymentStatus: 'AWAITING_PAYMENT' })).toThrow('PAYMENT_RESOLUTION_REQUIRED');
    expect(() => assertCancellationWindow({ ...base, lifecycleStatus: 'CANCELLED' })).toThrow('ORDER_ALREADY_CANCELLED');
    expect(() => assertCancellationWindow({ ...base, paymentStatus: 'AWAITING_COD' })).not.toThrow();
    expect(() => assertCancellationWindow({ ...base, paymentStatus: 'PAYMENT_FAILED' })).not.toThrow();
  });
  it('restocks consumed quantity without reopening reservation or changing reserved balance', () => {
    expect(restockDeltas(3)).toEqual({ onHandDelta: 3, reservedDelta: 0 });
    for (const q of [0, -1, 1.5, NaN, 1_000_001]) expect(() => restockDeltas(q)).toThrow('RESTOCK_QUANTITY_INVALID');
  });
  it('derives full refund only from matching verified money snapshots', () => {
    expect(fullRefundAmount(2500n, 2500n, 'BDT', 'BDT')).toBe(2500n);
    expect(() => fullRefundAmount(2500n, 2400n, 'BDT', 'BDT')).toThrow('REFUND_SNAPSHOT_MISMATCH');
    expect(() => fullRefundAmount(2500n, 2500n, 'BDT', 'USD')).toThrow('REFUND_SNAPSHOT_MISMATCH');
    expect(() => fullRefundAmount(0n, 0n, 'BDT', 'BDT')).toThrow('REFUND_SNAPSHOT_MISMATCH');
  });
});
