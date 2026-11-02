import { createHmac, timingSafeEqual } from 'node:crypto';

export type PaymentIntentStatus = 'CREATED' | 'PENDING' | 'UNKNOWN' | 'VERIFIED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
export type SandboxWebhookStatus = 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

export const paymentIntentTransitions: Record<PaymentIntentStatus, PaymentIntentStatus[]> = {
  CREATED: ['PENDING', 'UNKNOWN', 'VERIFIED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PENDING: ['UNKNOWN', 'VERIFIED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  UNKNOWN: ['VERIFIED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  VERIFIED: [], FAILED: [], CANCELLED: [], EXPIRED: []
};

export function assertPaymentIntentTransition(from: PaymentIntentStatus, to: PaymentIntentStatus): void {
  if (!(paymentIntentTransitions[from] ?? []).includes(to)) throw new Error(`PAYMENT_INTENT_INVALID_TRANSITION_${from}_${to}`);
}

export interface ProviderCapabilities {
  createCheckout: boolean;
  verifyTransaction: boolean;
  parseCallback: boolean;
  queryStatus: boolean;
  refund: boolean;
  queryRefund: boolean;
  dynamicOrderQR: boolean;
  disburse: boolean;
  verifyBeneficiary: boolean;
  reconcileStatement: boolean;
}

export const disabledProviderCapabilities: ProviderCapabilities = {
  createCheckout: false, verifyTransaction: false, parseCallback: false, queryStatus: false,
  refund: false, queryRefund: false, dynamicOrderQR: false, disburse: false, verifyBeneficiary: false, reconcileStatement: false
};

export const sandboxManualCapabilities: ProviderCapabilities = {
  ...disabledProviderCapabilities,
  createCheckout: true, verifyTransaction: true, parseCallback: true, queryStatus: true
};

export function assertProviderCapability(capabilities: ProviderCapabilities, operation: keyof ProviderCapabilities): void {
  if (!capabilities[operation]) throw new Error(`PROVIDER_CAPABILITY_DISABLED_${operation}`);
}

export function signSandboxWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function verifySandboxWebhookSignature(secret: string, timestamp: string, rawBody: string, signature: string, nowMs = Date.now(), maxAgeSeconds = 300): boolean {
  if (!/^[0-9]{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const age = Math.floor(nowMs / 1000) - Number(timestamp);
  if (age < -30 || age > maxAgeSeconds) return false;
  const expected = Buffer.from(signSandboxWebhook(secret, timestamp, rawBody), 'hex');
  const provided = Buffer.from(signature, 'hex');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function assertWebhookAmountCurrency(expectedAmountMinor: bigint, expectedCurrency: string, reportedAmountMinor: string, reportedCurrency: string): void {
  if (!/^(0|[1-9][0-9]*)$/.test(reportedAmountMinor)) throw new Error('WEBHOOK_AMOUNT_INVALID');
  if (BigInt(reportedAmountMinor) !== expectedAmountMinor) throw new Error('WEBHOOK_AMOUNT_MISMATCH');
  if (!/^[A-Z]{3}$/.test(reportedCurrency) || reportedCurrency !== expectedCurrency) throw new Error('WEBHOOK_CURRENCY_MISMATCH');
}
