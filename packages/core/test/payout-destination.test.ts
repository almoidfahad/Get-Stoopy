import { describe, expect, it } from 'vitest';
import { assertDestinationUsable, destinationEligibleAt, destinationFingerprint, destinationMask, destinationPayloadHash, isDestinationUsable, normalizeDestinationDetails } from '../src/index.js';

describe('verified payout destination policy', () => {
  const key = 'a'.repeat(64);
  const details = { rail: 'BANK' as const, accountHolderName: 'TEST ONLY Vendor', accountNumber: '000123456789', institutionName: 'TEST ONLY Bank' };
  const now = new Date('2026-11-03T00:00:00Z');
  const record = () => ({ status: 'VERIFIED' as const, countryId: 'bd', currency: 'BDT', verifiedAt: new Date(now.getTime() - 25 * 3600_000), eligibleAt: new Date(now.getTime() - 3600_000), vendor: { status: 'ACTIVE' as const, countryId: 'bd', kycCase: { subjectType: 'VENDOR' as const, status: 'APPROVED' as const, expiresAt: new Date(now.getTime() + 3600_000) } } });
  it('normalizes without inventing account ownership or provider verification', () => {
    expect(normalizeDestinationDetails({ ...details, accountNumber: '0001-2345 6789' })).toEqual(details);
    expect(destinationMask(details)).toBe('••••6789');
    expect(() => normalizeDestinationDetails({ ...details, accountNumber: '12' })).toThrow('DESTINATION_ACCOUNT_INVALID');
    expect(() => normalizeDestinationDetails({ ...details, rail: 'MERCHANT_MFS' })).toThrow('DESTINATION_ACCOUNT_INVALID');
  });
  it('uses domain-separated keyed fingerprints and detects every idempotency payload field', () => {
    expect(destinationFingerprint(details, key)).toMatch(/^[0-9a-f]{64}$/);
    expect(destinationFingerprint(details, key)).not.toBe(destinationFingerprint({ ...details, accountNumber: '000123456788' }, key));
    expect(destinationFingerprint(details, key)).not.toBe(destinationFingerprint(details, 'b'.repeat(64)));
    expect(destinationPayloadHash({ details, proofStorageObjectId: 'one' }, key)).not.toBe(destinationPayloadHash({ details, proofStorageObjectId: 'two' }, key));
    expect(() => destinationFingerprint(details, 'not-a-key')).toThrow('DESTINATION_KEY_REQUIRED');
  });
  it('requires cooldown, current vendor KYC, matching country/currency and verified state', () => {
    const r = record(); expect(isDestinationUsable(r, 'bd', 'BDT', now)).toBe(true);
    expect(isDestinationUsable({ ...r, eligibleAt: new Date(now.getTime() + 1) }, 'bd', 'BDT', now)).toBe(false);
    expect(isDestinationUsable({ ...r, status: 'PENDING_REVIEW' }, 'bd', 'BDT', now)).toBe(false);
    expect(isDestinationUsable({ ...r, status: 'RETIRED' }, 'bd', 'BDT', now)).toBe(false);
    expect(isDestinationUsable(r, 'bd', 'USD', now)).toBe(false);
    expect(isDestinationUsable(r, 'lk', 'BDT', now)).toBe(false);
    expect(isDestinationUsable({ ...r, vendor: { ...r.vendor, status: 'SUSPENDED' } }, 'bd', 'BDT', now)).toBe(false);
    expect(isDestinationUsable({ ...r, vendor: { ...r.vendor, kycCase: { ...r.vendor.kycCase, expiresAt: now } } }, 'bd', 'BDT', now)).toBe(false);
    expect(() => assertDestinationUsable(null, 'bd', 'BDT', now)).toThrow('PAYOUT_DESTINATION_REQUIRED');
  });
  it('bounds the cooldown and never makes a new destination immediately usable', () => {
    expect(destinationEligibleAt(now).getTime() - now.getTime()).toBe(24 * 3600_000);
    expect(isDestinationUsable({ ...record(), verifiedAt: now, eligibleAt: destinationEligibleAt(now) }, 'bd', 'BDT', now)).toBe(false);
    expect(() => destinationEligibleAt(now, 0)).toThrow('DESTINATION_COOLDOWN_INVALID');
    expect(() => destinationEligibleAt(now, 169)).toThrow('DESTINATION_COOLDOWN_INVALID');
  });
});
