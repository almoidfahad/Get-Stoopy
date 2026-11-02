import { describe, expect, it } from 'vitest';
import { riderDispatchEligibilityReasons } from '../src/index.js';

const now = new Date('2026-11-02T08:00:00Z');
const kyc = { subjectType: 'RIDER', status: 'APPROVED', expiresAt: '2026-12-01T00:00:00Z' } as any;
const base = {
  status: 'ACTIVE', countryId: 'bd', kycCase: kyc,
  activeShift: { id: 'shift', consentVersion: 'consent-v1' },
  consent: { consented: true, consentVersion: 'consent-v1' },
  zoneGrant: { id: 'grant', expiresAt: null, revokedAt: null },
  latestLocation: { accuracyMeters: 20, recordedAt: '2026-11-02T07:59:30Z', receivedAt: '2026-11-02T07:59:31Z' }
};

describe('rider dispatch eligibility', () => {
  it('allows a fresh consented in-zone rider', () => expect(riderDispatchEligibilityReasons(base, 'bd', now)).toEqual([]));
  it('requires KYC, shift, consent, zone grant and location', () => {
    expect(riderDispatchEligibilityReasons({ ...base, kycCase: null }, 'bd', now)).toContain('RIDER_KYC_REQUIRED');
    expect(riderDispatchEligibilityReasons({ ...base, activeShift: null }, 'bd', now)).toContain('RIDER_SHIFT_REQUIRED');
    expect(riderDispatchEligibilityReasons({ ...base, consent: null }, 'bd', now)).toContain('RIDER_LOCATION_CONSENT_REQUIRED');
    expect(riderDispatchEligibilityReasons({ ...base, zoneGrant: null }, 'bd', now)).toContain('RIDER_ZONE_GRANT_REQUIRED');
    expect(riderDispatchEligibilityReasons({ ...base, latestLocation: null }, 'bd', now)).toContain('RIDER_LOCATION_REQUIRED');
  });
  it('rejects stale, inaccurate, future and consent-version-mismatched locations', () => {
    expect(riderDispatchEligibilityReasons({ ...base, latestLocation: { ...base.latestLocation, recordedAt: '2026-11-02T07:57:00Z' } }, 'bd', now)).toContain('RIDER_LOCATION_STALE');
    expect(riderDispatchEligibilityReasons({ ...base, latestLocation: { ...base.latestLocation, accuracyMeters: 101 } }, 'bd', now)).toContain('RIDER_LOCATION_ACCURACY');
    expect(riderDispatchEligibilityReasons({ ...base, latestLocation: { ...base.latestLocation, recordedAt: '2026-11-02T08:01:00Z' } }, 'bd', now)).toContain('RIDER_LOCATION_FUTURE');
    expect(riderDispatchEligibilityReasons({ ...base, consent: { consented: true, consentVersion: 'consent-v2' } }, 'bd', now)).toContain('RIDER_CONSENT_VERSION_MISMATCH');
  });
  it('rejects expired or revoked zone grants', () => {
    expect(riderDispatchEligibilityReasons({ ...base, zoneGrant: { id: 'g', expiresAt: '2026-11-02T07:59:00Z', revokedAt: null } }, 'bd', now)).toContain('RIDER_ZONE_GRANT_REQUIRED');
    expect(riderDispatchEligibilityReasons({ ...base, zoneGrant: { id: 'g', expiresAt: null, revokedAt: '2026-11-02T07:59:00Z' } }, 'bd', now)).toContain('RIDER_ZONE_GRANT_REQUIRED');
  });
});
