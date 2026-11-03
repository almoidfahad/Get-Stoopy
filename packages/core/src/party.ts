import { isKycEligible, type KycEligibilityRecord } from './kyc.js';

export type PartyStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'RESTRICTED';
export type VendorMembershipRole = 'OWNER' | 'MANAGER' | 'STAFF';
export type RiderVehicleType = 'BICYCLE' | 'MOTORBIKE' | 'CAR' | 'OTHER';

export const partyTransitions: Record<PartyStatus, PartyStatus[]> = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['SUSPENDED','RESTRICTED'],
  SUSPENDED: ['ACTIVE'],
  RESTRICTED: ['ACTIVE']
};

export function assertPartyTransition(from: PartyStatus, to: PartyStatus): void {
  if (!(partyTransitions[from] ?? []).includes(to)) throw new Error(`PARTY_INVALID_TRANSITION_${from}_${to}`);
}

/** Vendor-scoped permissions are not global RBAC permissions. They are resolved only for
 * unexpired, unrevoked memberships of ACTIVE vendors with unexpired KYC approval.
 */
export const vendorRolePermissions: Record<VendorMembershipRole, string[]> = {
  OWNER: ['vendor:profile:read', 'vendor:profile:write', 'vendor:membership:read', 'vendor:membership:write', 'vendor:catalog:write', 'vendor:inventory:read', 'vendor:inventory:write', 'vendor:order:read', 'vendor:order:write'],
  MANAGER: ['vendor:profile:read', 'vendor:membership:read', 'vendor:catalog:write', 'vendor:inventory:read', 'vendor:inventory:write', 'vendor:order:read', 'vendor:order:write'],
  STAFF: ['vendor:profile:read', 'vendor:inventory:read', 'vendor:order:read']
};

export function vendorMembershipPermissions(role: VendorMembershipRole): string[] {
  return [...(vendorRolePermissions[role] ?? [])];
}

export interface PartyActivationRecord {
  status: PartyStatus;
  countryId: string;
  kycCase?: KycEligibilityRecord | null;
}

/** Fail-closed activation/eligibility helper. Activation is a privileged human command;
 * this helper does not grant roles, scopes, store access or delivery eligibility by itself.
 */
export function isPartyActiveWithKyc(record: PartyActivationRecord | null | undefined, subjectType: 'VENDOR' | 'RIDER', countryId: string, now = new Date()): boolean {
  if (!record || record.status !== 'ACTIVE' || record.countryId !== countryId) return false;
  return isKycEligible(record.kycCase, subjectType, now);
}

export function assertPartyActiveWithKyc(record: PartyActivationRecord | null | undefined, subjectType: 'VENDOR' | 'RIDER', countryId: string, now = new Date()): void {
  if (!isPartyActiveWithKyc(record, subjectType, countryId, now)) throw new Error('PARTY_KYC_ACTIVATION_REQUIRED');
}
