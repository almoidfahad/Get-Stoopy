import { createHash } from 'node:crypto';
import type { KycSubjectType } from './kyc.js';
export interface RetentionPolicyInput { countryId:string; subjectType:KycSubjectType; approvedRetentionDays:number; rejectedRetentionDays:number; revokedRetentionDays:number; reminderDays:number; legalBasis:string; policyVersion:string; }
export function retentionPolicyFingerprint(input:RetentionPolicyInput):string {
  const canonical = { countryId:input.countryId, subjectType:input.subjectType, approvedRetentionDays:input.approvedRetentionDays, rejectedRetentionDays:input.rejectedRetentionDays, revokedRetentionDays:input.revokedRetentionDays, reminderDays:input.reminderDays, legalBasis:input.legalBasis.trim(), policyVersion:input.policyVersion.trim() };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
export function isRetentionDue(status:string, dueAt:Date|string|null|undefined, now=new Date()):boolean {
  if (!['REJECTED','REVOKED','EXPIRED'].includes(status) || !dueAt) return false;
  const due = dueAt instanceof Date ? dueAt.getTime() : Date.parse(dueAt);
  return Number.isFinite(due) && due <= now.getTime();
}
