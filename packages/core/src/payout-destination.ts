import { createHmac } from 'node:crypto';
import { isPartyActiveWithKyc, type PartyActivationRecord } from './party.js';

export type PayoutRail = 'BANK' | 'MERCHANT_MFS';
export interface DestinationDetails { rail: PayoutRail; accountHolderName: string; accountNumber: string; institutionName: string; }
export interface DestinationEligibilityRecord {
  status: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED' | 'RETIRED';
  countryId: string; currency: string; verifiedAt: Date | null; eligibleAt: Date | null;
  vendor: PartyActivationRecord;
}
/** Development safety policy, not a claim of provider verification. No transfer is enabled here. */
export const DESTINATION_COOLDOWN_HOURS = 24;
export function destinationEligibleAt(verifiedAt: Date, hours = DESTINATION_COOLDOWN_HOURS): Date {
  if (!Number.isInteger(hours) || hours < 1 || hours > 168 || !Number.isFinite(verifiedAt.getTime())) throw new Error('DESTINATION_COOLDOWN_INVALID');
  return new Date(verifiedAt.getTime() + hours * 3600_000);
}
export function normalizeDestinationDetails(input: DestinationDetails): DestinationDetails {
  const accountHolderName = input.accountHolderName?.trim().replace(/\s+/g, ' ');
  const institutionName = input.institutionName?.trim().replace(/\s+/g, ' ');
  const accountNumber = input.accountNumber?.trim().replace(/[\s-]/g, '').toUpperCase();
  if (!accountHolderName || accountHolderName.length < 2 || accountHolderName.length > 200) throw new Error('DESTINATION_HOLDER_INVALID');
  if (!institutionName || institutionName.length < 2 || institutionName.length > 120) throw new Error('DESTINATION_INSTITUTION_INVALID');
  if (input.rail === 'BANK') {
    if (!accountNumber || !/^[A-Z0-9]{6,34}$/.test(accountNumber)) throw new Error('DESTINATION_ACCOUNT_INVALID');
  } else if (input.rail === 'MERCHANT_MFS') {
    if (!accountNumber || !/^\+[1-9][0-9]{7,14}$/.test(accountNumber)) throw new Error('DESTINATION_ACCOUNT_INVALID');
  } else throw new Error('DESTINATION_RAIL_INVALID');
  return { rail: input.rail, accountHolderName, institutionName, accountNumber };
}
export function destinationMask(details: DestinationDetails): string { return `••••${details.accountNumber.slice(-4)}`; }
/** Keyed fingerprints prevent offline guessing of low-entropy account numbers. Never use an unkeyed hash. */
export function destinationPayloadHash(value: unknown, hexKey: string): string {
  if (!/^[0-9a-f]{64}$/i.test(hexKey)) throw new Error('DESTINATION_KEY_REQUIRED');
  return createHmac('sha256', Buffer.from(hexKey, 'hex')).update('get-stoopy-payout-command-v1\0').update(JSON.stringify(value)).digest('hex');
}
export function destinationFingerprint(details: DestinationDetails, hexKey: string): string {
  if (!/^[0-9a-f]{64}$/i.test(hexKey)) throw new Error('DESTINATION_KEY_REQUIRED');
  return createHmac('sha256', Buffer.from(hexKey, 'hex')).update('get-stoopy-payout-destination-v1\0').update(JSON.stringify(normalizeDestinationDetails(details))).digest('hex');
}
export function isDestinationUsable(record: DestinationEligibilityRecord | null | undefined, countryId: string, currency: string, now = new Date()): boolean {
  if (!record || record.status !== 'VERIFIED' || record.countryId !== countryId || record.currency !== currency) return false;
  if (!record.verifiedAt || !record.eligibleAt || record.eligibleAt.getTime() > now.getTime() || record.eligibleAt <= record.verifiedAt) return false;
  return isPartyActiveWithKyc(record.vendor, 'VENDOR', countryId, now);
}
export function assertDestinationUsable(record: DestinationEligibilityRecord | null | undefined, countryId: string, currency: string, now = new Date()): void {
  if (!isDestinationUsable(record, countryId, currency, now)) throw new Error('PAYOUT_DESTINATION_REQUIRED');
}
