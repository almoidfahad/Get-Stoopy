/** Pure policy helpers for the first full-order, pre-dispatch cancellation slice. */
export type CancellationPaymentState = 'AWAITING_PAYMENT' | 'PAYMENT_VERIFIED' | 'PAYMENT_FAILED' | 'AWAITING_COD';
export interface CancellationWindowInput {
  lifecycleStatus: 'ACTIVE' | 'CANCELLED';
  paymentStatus: CancellationPaymentState;
  suborderStatuses: readonly string[];
  hasDispatchRun: boolean;
}
export function assertCancellationWindow(input: CancellationWindowInput): void {
  if (input.lifecycleStatus !== 'ACTIVE') throw new Error('ORDER_ALREADY_CANCELLED');
  // An outstanding online payment must reach a terminal result before inventory is
  // returned. A late success must never race a cancellation/restock transaction.
  if (input.paymentStatus === 'AWAITING_PAYMENT') throw new Error('PAYMENT_RESOLUTION_REQUIRED');
  if (input.hasDispatchRun || input.suborderStatuses.length === 0) throw new Error('CANCELLATION_WINDOW_CLOSED');
  if (input.suborderStatuses.some(s => s !== 'PENDING_VENDOR' && s !== 'REJECTED')) throw new Error('CANCELLATION_WINDOW_CLOSED');
}
/** Consumed reservations stay terminal; restock is a separate, linked movement. */
export function restockDeltas(quantity: number): { onHandDelta: number; reservedDelta: number } {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000) throw new Error('RESTOCK_QUANTITY_INVALID');
  return { onHandDelta: quantity, reservedDelta: 0 };
}
/** Full-order refund only, from the verified intent snapshot; never from client input. */
export function fullRefundAmount(orderAmount: bigint, intentAmount: bigint, orderCurrency: string, intentCurrency: string): bigint {
  if (orderAmount <= 0n || orderAmount !== intentAmount || orderCurrency !== intentCurrency) throw new Error('REFUND_SNAPSHOT_MISMATCH');
  return orderAmount;
}
