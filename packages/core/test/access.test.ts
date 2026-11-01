import { describe, expect, it } from 'vitest';
import { authorize, canGrantScope, inGeographicScope, type AccessContext, type ScopeGrant } from '../src/index.js';
const now = '2026-11-01T00:00:00Z';
const city: ScopeGrant = { id: 's1', type: 'CITY', countryId: 'bd', regionId: 'mym', districtId: 'mym', cityId: 'mym-city', zoneId: 'z1' };
const base: AccessContext = { userId: 'u1', sessionId: 'sess', authorizationVersion: 1, accountStatus: 'ACTIVE', assurance: 'MFA', permissions: ['order:read'], scopes: [city], vendorMemberships: [], now };
const resource = { countryId: 'bd', regionId: 'mym', districtId: 'mym', cityId: 'mym-city', zoneId: 'z1' };
describe('geographic authorization', () => {
  it('allows assigned city', () => expect(authorize(base, 'order:read', resource).allow).toBe(true));
  it('denies other city without leaking resource', () => expect(authorize(base, 'order:read', { ...resource, cityId: 'dhaka' })).toEqual({ allow: false, reason: 'GEOGRAPHIC_SCOPE_DENIED' }));
  it('denies missing permission even inside scope', () => expect(authorize(base, 'finance:payout', resource).allow).toBe(false));
  it('denies suspended account', () => expect(authorize({ ...base, accountStatus: 'SUSPENDED' }, 'order:read', resource).allow).toBe(false));
  it('requires MFA for privileged permission', () => expect(authorize({ ...base, assurance: 'PASSWORD' }, 'order:read', resource, { requireMfa: true }).allow).toBe(false));
  it('requires step-up', () => expect(authorize(base, 'order:read', resource, { requireStepUp: true }).allow).toBe(false));
  it('expires scope grants', () => expect(inGeographicScope({ ...base, scopes: [{ ...city, expiresAt: '2026-10-31T00:00:00Z' }] }, resource)).toBe(false));
  it('revokes scope grants', () => expect(inGeographicScope({ ...base, scopes: [{ ...city, revokedAt: now }] }, resource)).toBe(false));
  it('allows owner path only when explicitly enabled', () => expect(authorize(base, 'order:read', { countryId: 'bd', ownerUserId: 'u1' }, { allowOwner: true }).allow).toBe(true));
  it('does not let buyer residence widen destination scope', () => expect(authorize(base, 'order:read', { countryId: 'bd', cityId: 'dhaka', ownerUserId: 'other' }).allow).toBe(false));
});
describe('vendor/rider ownership', () => {
  it('allows own vendor store', () => expect(authorize({ ...base, vendorMemberships: [{ vendorId: 'v1', storeId: 'st1', permissions: ['order:read'] }] }, 'order:read', { countryId: 'bd', vendorId: 'v1', storeId: 'st1' }, { allowVendor: true }).allow).toBe(true));
  it('denies other vendor', () => expect(authorize({ ...base, vendorMemberships: [{ vendorId: 'v1', permissions: ['order:read'] }] }, 'order:read', { countryId: 'bd', vendorId: 'v2' }, { allowVendor: true }).allow).toBe(false));
  it('denies store mismatch', () => expect(authorize({ ...base, vendorMemberships: [{ vendorId: 'v1', storeId: 'st1', permissions: ['order:read'] }] }, 'order:read', { countryId: 'bd', vendorId: 'v1', storeId: 'st2' }, { allowVendor: true }).allow).toBe(false));
  it('allows own rider resource', () => expect(authorize({ ...base, riderId: 'r1' }, 'order:read', { countryId: 'bd', riderId: 'r1' }, { allowRider: true }).allow).toBe(true));
});
describe('scope grants', () => {
  const grantor: AccessContext = { ...base, assurance: 'STEP_UP', permissions: ['admin:scope:grant'] };
  it('denies self grant', () => expect(canGrantScope(grantor, city, 'u1').allow).toBe(false));
  it('denies escalation to country', () => expect(canGrantScope(grantor, { id: 's2', type: 'COUNTRY', countryId: 'bd' }, 'u2').allow).toBe(false));
  it('allows descendant zone with step-up', () => expect(canGrantScope(grantor, { ...city, id: 's2', type: 'ZONE' }, 'u2').allow).toBe(true));
  it('denies without step-up', () => expect(canGrantScope({ ...grantor, assurance: 'MFA' }, city, 'u2').allow).toBe(false));
});
