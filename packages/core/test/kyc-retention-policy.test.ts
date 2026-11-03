import { describe, expect, it } from 'vitest';
import { isRetentionDue, retentionPolicyFingerprint } from '../src/kyc-retention.js';
const base={countryId:'c',subjectType:'VENDOR' as const,approvedRetentionDays:30,rejectedRetentionDays:0,revokedRetentionDays:7,reminderDays:7,legalBasis:'Owner approved policy',policyVersion:'v1'};
describe('retention policy helpers',()=>{
 it('fingerprints canonical policy values and detects changed day counts',()=>{expect(retentionPolicyFingerprint(base)).toBe(retentionPolicyFingerprint({...base,legalBasis:'  Owner approved policy  '}));expect(retentionPolicyFingerprint(base)).not.toBe(retentionPolicyFingerprint({...base,approvedRetentionDays:31}));});
 it('requires terminal status and elapsed due date',()=>{const now=new Date('2026-01-02T00:00:00Z');expect(isRetentionDue('EXPIRED',new Date('2026-01-01T00:00:00Z'),now)).toBe(true);expect(isRetentionDue('APPROVED',new Date('2026-01-01T00:00:00Z'),now)).toBe(false);expect(isRetentionDue('EXPIRED',null,now)).toBe(false);expect(isRetentionDue('EXPIRED',new Date('2026-01-03T00:00:00Z'),now)).toBe(false);});
});
