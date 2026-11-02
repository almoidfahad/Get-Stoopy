import { isKycEligible, type KycEligibilityRecord } from './kyc.js';
import { LOCATION_FRESHNESS_SECONDS, LOCATION_MAX_ACCURACY_METERS, LOCATION_MAX_FUTURE_SKEW_SECONDS } from './serviceability.js';

export interface RiderEligibilityRecord {
  status: string;
  countryId: string;
  kycCase?: KycEligibilityRecord | null;
  activeShift?: { id: string; consentVersion: string } | null;
  consent?: { consented: boolean; consentVersion: string } | null;
  zoneGrant?: { id: string; expiresAt?: string | null; revokedAt?: string | null } | null;
  latestLocation?: { accuracyMeters: number; recordedAt: string; receivedAt: string } | null;
}

export function isRiderKycEligible(record: Pick<RiderEligibilityRecord, 'status' | 'countryId' | 'kycCase'>, countryId: string, now = new Date()): boolean {
  return record.status === 'ACTIVE' && record.countryId === countryId && isKycEligible(record.kycCase ?? null, 'RIDER', now);
}

export function riderDispatchEligibilityReasons(record: RiderEligibilityRecord, countryId: string, now = new Date()): string[] {
  const reasons: string[] = [];
  if (!isRiderKycEligible(record, countryId, now)) reasons.push('RIDER_KYC_REQUIRED');
  if (!record.activeShift) reasons.push('RIDER_SHIFT_REQUIRED');
  if (!record.consent?.consented) reasons.push('RIDER_LOCATION_CONSENT_REQUIRED');
  if (record.activeShift && record.consent?.consented && record.activeShift.consentVersion !== record.consent.consentVersion) reasons.push('RIDER_CONSENT_VERSION_MISMATCH');
  const grant = record.zoneGrant;
  if (!grant || grant.revokedAt || (grant.expiresAt && Date.parse(grant.expiresAt) <= now.getTime())) reasons.push('RIDER_ZONE_GRANT_REQUIRED');
  const loc = record.latestLocation;
  if (!loc) reasons.push('RIDER_LOCATION_REQUIRED');
  else {
    if (loc.accuracyMeters > LOCATION_MAX_ACCURACY_METERS) reasons.push('RIDER_LOCATION_ACCURACY');
    const ageMs = now.getTime() - Date.parse(loc.recordedAt);
    if (ageMs > LOCATION_FRESHNESS_SECONDS * 1000) reasons.push('RIDER_LOCATION_STALE');
    if (ageMs < -LOCATION_MAX_FUTURE_SKEW_SECONDS * 1000) reasons.push('RIDER_LOCATION_FUTURE');
  }
  return reasons;
}

export function assertRiderDispatchEligible(record: RiderEligibilityRecord, countryId: string, now = new Date()): void {
  const reasons = riderDispatchEligibilityReasons(record, countryId, now);
  if (reasons.length) throw new Error(reasons[0]!);
}
