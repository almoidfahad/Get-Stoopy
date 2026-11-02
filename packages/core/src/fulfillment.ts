import { manualReady, transition } from './states.js';

/** Implemented vendor readiness states. Dispatch/delivery states remain separate future slices. */
export const vendorReadinessTransitions: Record<string, string[]> = {
  PENDING_VENDOR: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['PREPARING'],
  PREPARING: ['READY_FOR_PICKUP'],
  READY_FOR_PICKUP: [],
  REJECTED: []
};

export const MIN_PREPARATION_MINUTES = 1;
export const MAX_PREPARATION_MINUTES = 24 * 60;

export function assertVendorReadinessTransition(from: string, to: string): void {
  transition(vendorReadinessTransitions, from, to);
}

export function assertPreparationMinutes(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < MIN_PREPARATION_MINUTES || minutes > MAX_PREPARATION_MINUTES) {
    throw new Error('PREPARATION_MINUTES_INVALID');
  }
}

export function assertRejectionReason(reason: string): string {
  const trimmed = reason?.trim();
  if (!trimmed || trimmed.length < 8 || trimmed.length > 512) throw new Error('REJECTION_REASON_REQUIRED');
  return trimmed;
}

/** Vendor readiness is a manual human confirmation. Timers and customers cannot confirm ready. */
export function assertVendorManualReady(from: string, timerExpired = false): void {
  manualReady(from, 'VENDOR', timerExpired);
  assertVendorReadinessTransition(from, 'READY_FOR_PICKUP');
}

export function assertFulfillmentCommandKey(key: string): void {
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(key)) throw new Error('FULFILLMENT_COMMAND_KEY_INVALID');
}
