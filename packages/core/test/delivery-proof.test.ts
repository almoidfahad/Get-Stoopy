import { describe, expect, it } from 'vitest';
import { deliveryCompletionGate, deliveryOtpHash, generateDeliveryOtp, maskPhone, normalizeRecipientPhone, recipientPhoneHash, verifyDeliveryOtp } from '../src/index.js';

const pepper = 'a'.repeat(64);

describe('delivery proof helpers', () => {
  it('generates six digit OTPs and binds HMAC hashes to challenge id', () => {
    const code = generateDeliveryOtp();
    expect(code).toMatch(/^[0-9]{6}$/);
    const hash = deliveryOtpHash(pepper, 'challenge-1', code);
    expect(verifyDeliveryOtp(pepper, 'challenge-1', code, hash)).toBe(true);
    expect(verifyDeliveryOtp(pepper, 'challenge-2', code, hash)).toBe(false);
    expect(verifyDeliveryOtp(pepper, 'challenge-1', '000000', hash)).toBe(code === '000000');
    expect(() => deliveryOtpHash('short', 'challenge-1', code)).toThrow('DELIVERY_OTP_PEPPER_INVALID');
    expect(() => deliveryOtpHash(pepper, 'challenge-1', '12345')).toThrow('DELIVERY_OTP_FORMAT_INVALID');
  });
  it('normalizes and masks recipient phones without storing plaintext in hashes', () => {
    expect(normalizeRecipientPhone('+880 1712-345678', '+880')).toBe('+8801712345678');
    expect(() => normalizeRecipientPhone('01712345678', '+880')).toThrow('RECIPIENT_PHONE_INVALID');
    expect(() => normalizeRecipientPhone('+12025550123', '+880')).toThrow('RECIPIENT_PHONE_COUNTRY_MISMATCH');
    expect(maskPhone('+8801712345678')).toBe('******5678');
    expect(recipientPhoneHash(pepper, '+8801712345678')).toMatch(/^[0-9a-f]{64}$/);
    expect(recipientPhoneHash(pepper, '+8801712345678')).not.toContain('1712345678');
  });
  it('gates completion on proof, payment and COD accounting', () => {
    expect(deliveryCompletionGate({ deliveryStatus: 'DELIVERED', proofVerified: true, paymentMethod: 'SANDBOX_MANUAL', paymentStatus: 'PAYMENT_VERIFIED', codAccountingVerified: false })).toBeNull();
    expect(deliveryCompletionGate({ deliveryStatus: 'PICKED_UP', proofVerified: true, paymentMethod: 'COD', paymentStatus: 'AWAITING_COD', codAccountingVerified: true })).toBe('DELIVERY_NOT_DELIVERED');
    expect(deliveryCompletionGate({ deliveryStatus: 'DELIVERED', proofVerified: false, paymentMethod: 'COD', paymentStatus: 'AWAITING_COD', codAccountingVerified: true })).toBe('DELIVERY_PROOF_REQUIRED');
    expect(deliveryCompletionGate({ deliveryStatus: 'DELIVERED', proofVerified: true, paymentMethod: 'COD', paymentStatus: 'AWAITING_COD', codAccountingVerified: false })).toBe('COD_ACCOUNTING_REQUIRED');
    expect(deliveryCompletionGate({ deliveryStatus: 'DELIVERED', proofVerified: true, paymentMethod: 'SANDBOX_MANUAL', paymentStatus: 'AWAITING_PAYMENT', codAccountingVerified: false })).toBe('PAYMENT_NOT_VERIFIED');
  });
});
