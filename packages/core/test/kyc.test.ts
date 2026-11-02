import { describe, expect, it } from 'vitest';
import { assertKycEligible, assertKycTransition, isKycEligible, kycDecisionTarget } from '../src/kyc';

describe('KYC case state machine and eligibility', () => {
  it('allows the explicit applicant/reviewer lifecycle', () => {
    expect(() => assertKycTransition('DRAFT', 'SUBMITTED')).not.toThrow();
    expect(() => assertKycTransition('SUBMITTED', 'UNDER_REVIEW')).not.toThrow();
    expect(() => assertKycTransition('UNDER_REVIEW', 'APPROVED')).not.toThrow();
    expect(() => assertKycTransition('UNDER_REVIEW', 'MORE_INFORMATION')).not.toThrow();
    expect(() => assertKycTransition('MORE_INFORMATION', 'SUBMITTED')).not.toThrow();
    expect(() => assertKycTransition('APPROVED', 'REVOKED')).not.toThrow();
  });
  it('denies skipped, terminal and self-approval transitions', () => {
    expect(() => assertKycTransition('DRAFT', 'APPROVED')).toThrow('KYC_INVALID_TRANSITION');
    expect(() => assertKycTransition('SUBMITTED', 'APPROVED')).toThrow('KYC_INVALID_TRANSITION');
    expect(() => assertKycTransition('REJECTED', 'SUBMITTED')).toThrow('KYC_INVALID_TRANSITION');
    expect(() => assertKycTransition('REVOKED', 'APPROVED')).toThrow('KYC_INVALID_TRANSITION');
  });
  it('maps reviewer decisions to explicit target states', () => {
    expect(kycDecisionTarget('SUBMITTED', 'START_REVIEW')).toBe('UNDER_REVIEW');
    expect(kycDecisionTarget('UNDER_REVIEW', 'APPROVE')).toBe('APPROVED');
    expect(kycDecisionTarget('UNDER_REVIEW', 'REQUEST_MORE_INFORMATION')).toBe('MORE_INFORMATION');
    expect(kycDecisionTarget('APPROVED', 'REVOKE')).toBe('REVOKED');
    expect(() => kycDecisionTarget('DRAFT', 'APPROVE')).toThrow('KYC_INVALID_TRANSITION');
  });
  it('fails closed unless an unexpired matching approval exists', () => {
    const now = new Date('2026-11-02T00:00:00.000Z');
    const approved = { subjectType: 'VENDOR' as const, status: 'APPROVED' as const, expiresAt: new Date('2026-12-01T00:00:00.000Z') };
    expect(isKycEligible(approved, 'VENDOR', now)).toBe(true);
    expect(isKycEligible(approved, 'RIDER', now)).toBe(false);
    expect(isKycEligible({ ...approved, expiresAt: now }, 'VENDOR', now)).toBe(false);
    expect(isKycEligible({ ...approved, expiresAt: null }, 'VENDOR', now)).toBe(false);
    expect(isKycEligible({ ...approved, status: 'REVOKED' }, 'VENDOR', now)).toBe(false);
    expect(isKycEligible(null, 'VENDOR', now)).toBe(false);
    expect(() => assertKycEligible({ ...approved, expiresAt: 'invalid' }, 'VENDOR', now)).toThrow('KYC_APPROVAL_REQUIRED');
  });
});
