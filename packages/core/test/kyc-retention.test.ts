import { describe, expect, it } from 'vitest';
import { assertKycTransition, isKycEligible } from '../src/kyc.js';
import { assertPartyTransition } from '../src/party.js';
describe('KYC retention state helpers', () => {
 it('allows approved to expired but not expired to approved', () => { expect(() => assertKycTransition('APPROVED','EXPIRED')).not.toThrow(); expect(() => assertKycTransition('EXPIRED','APPROVED')).toThrow(/KYC_INVALID_TRANSITION/); });
 it('fails closed on expired status and timestamp', () => { const now=new Date('2026-01-01T00:00:00Z'); expect(isKycEligible({status:'EXPIRED',expiresAt:new Date('2027-01-01T00:00:00Z')},'VENDOR',now)).toBe(false); expect(isKycEligible({status:'APPROVED',expiresAt:now},'VENDOR',now)).toBe(false); });
 it('supports restriction and renewed activation transitions', () => { expect(() => assertPartyTransition('ACTIVE','RESTRICTED')).not.toThrow(); expect(() => assertPartyTransition('RESTRICTED','ACTIVE')).not.toThrow(); });
});
