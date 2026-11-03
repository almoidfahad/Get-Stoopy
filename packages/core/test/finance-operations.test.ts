import { describe, expect, it } from 'vitest';
import { adjustedPayableMinor, assertSandboxTransition, sandboxProviderReference } from '../src/index.js';
describe('sandbox finance operations', () => {
 it('permits only reserved→submitted→terminal transitions', () => {
  expect(() => assertSandboxTransition('RESERVED','SUBMITTED')).not.toThrow();
  expect(() => assertSandboxTransition('SUBMITTED','SUCCEEDED')).not.toThrow();
  expect(() => assertSandboxTransition('SUBMITTED','FAILED')).not.toThrow();
  expect(() => assertSandboxTransition('RESERVED','SUCCEEDED')).toThrow('SANDBOX_TRANSFER_TRANSITION_INVALID');
  expect(() => assertSandboxTransition('SUCCEEDED','SUBMITTED')).toThrow('SANDBOX_TRANSFER_TRANSITION_INVALID');
 });
 it('keeps adjusted payable integral and non-negative', () => {
  expect(adjustedPayableMinor(900n,[-50n,25n])).toBe(875n);
  expect(adjustedPayableMinor(900n,[-900n])).toBe(0n);
  expect(() => adjustedPayableMinor(900n,[-901n])).toThrow('ADJUSTMENT_PAYABLE_INVALID');
  expect(() => adjustedPayableMinor(0n,[])).toThrow('ADJUSTMENT_AMOUNT_INVALID');
 });
 it('derives deterministic TEST_ONLY provider keys', () => {
  const id='11111111-1111-4111-8111-111111111111';expect(sandboxProviderReference('PAYOUT',id)).toBe(`TEST_ONLY:PAYOUT:${id}`);
  expect(() => sandboxProviderReference('REFUND','live-account')).toThrow('SANDBOX_TRANSFER_ID_INVALID');
 });
});
