import { describe, expect, it } from 'vitest';
import { assertFulfillmentCommandKey, assertPreparationMinutes, assertRejectionReason, assertVendorManualReady, assertVendorReadinessTransition } from '../src/index.js';

describe('vendor suborder readiness', () => {
  it('allows only the implemented readiness path', () => {
    expect(() => assertVendorReadinessTransition('PENDING_VENDOR', 'ACCEPTED')).not.toThrow();
    expect(() => assertVendorReadinessTransition('ACCEPTED', 'PREPARING')).not.toThrow();
    expect(() => assertVendorReadinessTransition('PREPARING', 'READY_FOR_PICKUP')).not.toThrow();
    expect(() => assertVendorReadinessTransition('PENDING_VENDOR', 'READY_FOR_PICKUP')).toThrow('INVALID_TRANSITION_PENDING_VENDOR_READY_FOR_PICKUP');
    expect(() => assertVendorReadinessTransition('READY_FOR_PICKUP', 'PREPARING')).toThrow();
    expect(() => assertVendorReadinessTransition('REJECTED', 'ACCEPTED')).toThrow();
  });
  it('requires a manual vendor ready confirmation and rejects timers', () => {
    expect(() => assertVendorManualReady('PREPARING')).not.toThrow();
    expect(() => assertVendorManualReady('PREPARING', true)).toThrow('TIMER_CANNOT_CONFIRM_READY');
    expect(() => assertVendorManualReady('ACCEPTED')).toThrow();
  });
  it('bounds preparation minutes and rejection reasons', () => {
    expect(() => assertPreparationMinutes(1)).not.toThrow();
    expect(() => assertPreparationMinutes(1440)).not.toThrow();
    expect(() => assertPreparationMinutes(0)).toThrow('PREPARATION_MINUTES_INVALID');
    expect(() => assertPreparationMinutes(1441)).toThrow('PREPARATION_MINUTES_INVALID');
    expect(() => assertPreparationMinutes(1.5)).toThrow('PREPARATION_MINUTES_INVALID');
    expect(assertRejectionReason('  out of stock for today  ')).toBe('out of stock for today');
    expect(() => assertRejectionReason('short')).toThrow('REJECTION_REASON_REQUIRED');
  });
  it('validates idempotency command keys', () => {
    expect(() => assertFulfillmentCommandKey('ready-12345678')).not.toThrow();
    expect(() => assertFulfillmentCommandKey('bad key')).toThrow('FULFILLMENT_COMMAND_KEY_INVALID');
    expect(() => assertFulfillmentCommandKey('short')).toThrow('FULFILLMENT_COMMAND_KEY_INVALID');
  });
});
