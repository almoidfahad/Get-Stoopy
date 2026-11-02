import { describe, expect, it } from 'vitest';
import { assertPaymentIntentTransition, assertProviderCapability, assertWebhookAmountCurrency, sandboxManualCapabilities, signSandboxWebhook, verifySandboxWebhookSignature } from '../src/payment.js';

describe('payment adapter primitives', () => {
  it('enforces terminal payment intent states', () => {
    expect(() => assertPaymentIntentTransition('PENDING', 'VERIFIED')).not.toThrow();
    expect(() => assertPaymentIntentTransition('UNKNOWN', 'VERIFIED')).not.toThrow();
    expect(() => assertPaymentIntentTransition('VERIFIED', 'FAILED')).toThrow('PAYMENT_INTENT_INVALID_TRANSITION');
    expect(() => assertPaymentIntentTransition('FAILED', 'VERIFIED')).toThrow('PAYMENT_INTENT_INVALID_TRANSITION');
  });
  it('gates unsupported provider capabilities', () => {
    expect(() => assertProviderCapability(sandboxManualCapabilities, 'createCheckout')).not.toThrow();
    expect(() => assertProviderCapability(sandboxManualCapabilities, 'refund')).toThrow('PROVIDER_CAPABILITY_DISABLED_refund');
    expect(() => assertProviderCapability(sandboxManualCapabilities, 'disburse')).toThrow('PROVIDER_CAPABILITY_DISABLED_disburse');
  });
  it('verifies sandbox HMAC and rejects replay/tampering', () => {
    const secret = 's'.repeat(32); const timestamp = '1700000000'; const body = '{"eventId":"e1"}';
    const sig = signSandboxWebhook(secret, timestamp, body);
    expect(verifySandboxWebhookSignature(secret, timestamp, body, sig, 1700000000000)).toBe(true);
    expect(verifySandboxWebhookSignature(secret, timestamp, body + ' ', sig, 1700000000000)).toBe(false);
    expect(verifySandboxWebhookSignature(secret, timestamp, body, sig, 1700000400000)).toBe(false);
    expect(verifySandboxWebhookSignature('x'.repeat(32), timestamp, body, sig, 1700000000000)).toBe(false);
  });
  it('matches exact minor units and currency', () => {
    expect(() => assertWebhookAmountCurrency(1000n, 'BDT', '1000', 'BDT')).not.toThrow();
    expect(() => assertWebhookAmountCurrency(1000n, 'BDT', '1001', 'BDT')).toThrow('WEBHOOK_AMOUNT_MISMATCH');
    expect(() => assertWebhookAmountCurrency(1000n, 'BDT', '1000', 'USD')).toThrow('WEBHOOK_CURRENCY_MISMATCH');
    expect(() => assertWebhookAmountCurrency(1000n, 'BDT', '10.00', 'BDT')).toThrow('WEBHOOK_AMOUNT_INVALID');
  });
});
