import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const DELIVERY_OTP_DIGITS = 6;
export const DELIVERY_OTP_TTL_SECONDS_DEFAULT = 300;
export const DELIVERY_OTP_MAX_ATTEMPTS_DEFAULT = 5;
export const DELIVERY_OTP_RESEND_COOLDOWN_SECONDS_DEFAULT = 60;
export const DELIVERY_OTP_MAX_ISSUES_DEFAULT = 3;

export function assertDeliveryCommandKey(key: string): void {
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(key)) throw new Error('DELIVERY_COMMAND_KEY_INVALID');
}

export function normalizeRecipientPhone(phone: string, callingCode: string): string {
  const trimmed = phone?.trim().replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(trimmed)) throw new Error('RECIPIENT_PHONE_INVALID');
  if (!/^\+[1-9]\d{0,3}$/.test(callingCode) || !trimmed.startsWith(callingCode)) throw new Error('RECIPIENT_PHONE_COUNTRY_MISMATCH');
  return trimmed;
}

export function generateDeliveryOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(DELIVERY_OTP_DIGITS, '0');
}

function assertPepper(pepper: string): void {
  if (!/^[0-9a-f]{64}$/i.test(pepper)) throw new Error('DELIVERY_OTP_PEPPER_INVALID');
}

/** Domain-separated HMAC: plain SHA-256 of a six-digit code is brute-forceable. */
export function deliveryOtpHash(pepper: string, challengeId: string, code: string): string {
  assertPepper(pepper);
  if (!/^[0-9]{6}$/.test(code)) throw new Error('DELIVERY_OTP_FORMAT_INVALID');
  return createHmac('sha256', Buffer.from(pepper, 'hex')).update(`get-stoopy-delivery-otp-v1:${challengeId}:${code}`).digest('hex');
}

export function verifyDeliveryOtp(pepper: string, challengeId: string, code: string, expectedHash: string): boolean {
  if (!/^[0-9]{6}$/.test(code) || !/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(deliveryOtpHash(pepper, challengeId, code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function recipientPhoneHash(pepper: string, phoneE164: string): string {
  assertPepper(pepper);
  return createHmac('sha256', Buffer.from(pepper, 'hex')).update(`get-stoopy-recipient-phone-v1:${phoneE164}`).digest('hex');
}

export function maskPhone(phoneE164: string): string {
  return phoneE164.length <= 4 ? '****' : `******${phoneE164.slice(-4)}`;
}

export const deliveryTransitions: Record<string, string[]> = {
  AWAITING_PICKUP: ['PICKED_UP'],
  PICKED_UP: ['DELIVERED'],
  DELIVERED: ['COMPLETED'],
  COMPLETED: []
};

export function assertDeliveryTransition(from: string, to: string): void {
  if (!(deliveryTransitions[from] ?? []).includes(to)) throw new Error(`DELIVERY_INVALID_TRANSITION_${from}_${to}`);
}

/** COD cannot complete until the later COD-accounting slice verifies custody/deposit accounting. */
export function deliveryCompletionGate(input: { deliveryStatus: string; proofVerified: boolean; paymentMethod: string; paymentStatus: string; codAccountingVerified: boolean }): string | null {
  if (input.deliveryStatus !== 'DELIVERED') return 'DELIVERY_NOT_DELIVERED';
  if (!input.proofVerified) return 'DELIVERY_PROOF_REQUIRED';
  if (input.paymentMethod === 'COD') return input.codAccountingVerified ? null : 'COD_ACCOUNTING_REQUIRED';
  return input.paymentStatus === 'PAYMENT_VERIFIED' ? null : 'PAYMENT_NOT_VERIFIED';
}
