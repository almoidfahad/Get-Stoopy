/** Explicit KYC case state machine for the foundation slice.
 * Expiry is evaluated from expiresAt; scheduled EXPIRED transition is implemented by retention automation.
 */
export type KycSubjectType = 'VENDOR' | 'RIDER' | 'ADMIN';
export type KycCaseStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'MORE_INFORMATION' | 'APPROVED' | 'REJECTED' | 'REVOKED' | 'EXPIRED';
export type KycDecision = 'START_REVIEW' | 'APPROVE' | 'REJECT' | 'REQUEST_MORE_INFORMATION' | 'REVOKE';

export const kycCaseTransitions: Record<KycCaseStatus, KycCaseStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'MORE_INFORMATION'],
  MORE_INFORMATION: ['SUBMITTED'],
  APPROVED: ['REVOKED','EXPIRED'],
  EXPIRED: [],
  REJECTED: [],
  REVOKED: []
};

export function assertKycTransition(from: KycCaseStatus, to: KycCaseStatus): void {
  if (!(kycCaseTransitions[from] ?? []).includes(to)) {
    throw new Error(`KYC_INVALID_TRANSITION_${from}_${to}`);
  }
}

export function kycDecisionTarget(from: KycCaseStatus, decision: KycDecision): KycCaseStatus {
  const target: Record<KycDecision, KycCaseStatus> = {
    START_REVIEW: 'UNDER_REVIEW',
    APPROVE: 'APPROVED',
    REJECT: 'REJECTED',
    REQUEST_MORE_INFORMATION: 'MORE_INFORMATION',
    REVOKE: 'REVOKED'
  };
  const to = target[decision];
  assertKycTransition(from, to);
  return to;
}

export interface KycEligibilityRecord {
  subjectType: KycSubjectType;
  status: KycCaseStatus;
  expiresAt: Date | string | null;
}

/** Fail-closed eligibility helper. Future commerce/shift/privileged-access commands must call this
 * together with their own role, zone, consent and account-status checks. It is not a role grant.
 */
export function isKycEligible(record: KycEligibilityRecord | null | undefined, subjectType: KycSubjectType, now = new Date()): boolean {
  if (!record || record.subjectType !== subjectType || record.status !== 'APPROVED' || !record.expiresAt) return false;
  const expiry = record.expiresAt instanceof Date ? record.expiresAt.getTime() : Date.parse(record.expiresAt);
  return Number.isFinite(expiry) && expiry > now.getTime();
}

export function assertKycEligible(record: KycEligibilityRecord | null | undefined, subjectType: KycSubjectType, now = new Date()): void {
  if (!isKycEligible(record, subjectType, now)) throw new Error('KYC_APPROVAL_REQUIRED');
}
