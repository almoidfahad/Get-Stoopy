import { describe, expect, it } from 'vitest';
import { assertPartyActiveWithKyc, assertPartyTransition, isPartyActiveWithKyc, vendorMembershipPermissions } from '../src/party';

describe('party activation and vendor membership helpers', () => {
  it('allows only explicit party lifecycle transitions', () => {
    expect(() => assertPartyTransition('DRAFT', 'ACTIVE')).not.toThrow();
    expect(() => assertPartyTransition('ACTIVE', 'SUSPENDED')).not.toThrow();
    expect(() => assertPartyTransition('SUSPENDED', 'ACTIVE')).not.toThrow();
    expect(() => assertPartyTransition('DRAFT', 'SUSPENDED')).toThrow('PARTY_INVALID_TRANSITION');
    expect(() => assertPartyTransition('SUSPENDED', 'DRAFT')).toThrow('PARTY_INVALID_TRANSITION');
  });
  it('fails closed unless party is active, country-matched and KYC-unexpired', () => {
    const now = new Date('2026-11-02T00:00:00.000Z');
    const kyc = { subjectType: 'VENDOR' as const, status: 'APPROVED' as const, expiresAt: new Date('2026-12-01T00:00:00.000Z') };
    const active = { status: 'ACTIVE' as const, countryId: 'bd', kycCase: kyc };
    expect(isPartyActiveWithKyc(active, 'VENDOR', 'bd', now)).toBe(true);
    expect(isPartyActiveWithKyc(active, 'RIDER', 'bd', now)).toBe(false);
    expect(isPartyActiveWithKyc(active, 'VENDOR', 'lk', now)).toBe(false);
    expect(isPartyActiveWithKyc({ ...active, status: 'SUSPENDED' }, 'VENDOR', 'bd', now)).toBe(false);
    expect(isPartyActiveWithKyc({ ...active, kycCase: { ...kyc, expiresAt: now } }, 'VENDOR', 'bd', now)).toBe(false);
    expect(isPartyActiveWithKyc({ ...active, kycCase: null }, 'VENDOR', 'bd', now)).toBe(false);
    expect(() => assertPartyActiveWithKyc(null, 'VENDOR', 'bd', now)).toThrow('PARTY_KYC_ACTIVATION_REQUIRED');
  });
  it('returns defensive copies of vendor-scoped permissions', () => {
    const owner = vendorMembershipPermissions('OWNER');
    expect(owner).toContain('vendor:order:write');
    owner.push('admin:scope:grant');
    expect(vendorMembershipPermissions('OWNER')).not.toContain('admin:scope:grant');
    expect(vendorMembershipPermissions('STAFF')).not.toContain('vendor:catalog:write');
  });
});
