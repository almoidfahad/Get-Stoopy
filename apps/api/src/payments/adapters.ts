import { assertProviderCapability, disabledProviderCapabilities, sandboxManualCapabilities, type ProviderCapabilities } from '@getstoopy/core';

export interface CreateCheckoutInput {
  merchantReference: string;
  amountMinor: bigint;
  currency: string;
  orderId: string;
}
export interface CreateCheckoutResult {
  provider: 'SANDBOX_MANUAL';
  environment: 'SANDBOX';
  mode: 'TEST_ONLY';
  merchantReference: string;
  redirectUrl: null;
  instructions: string;
}
export interface VerifiedTransaction {
  merchantReference: string;
  providerReference: string | null;
  amountMinor: bigint;
  currency: string;
  status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  verificationMethod: string;
}
export interface PaymentAdapter {
  readonly provider: string;
  readonly capabilities: ProviderCapabilities;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  verifyTransaction(merchantReference: string): Promise<VerifiedTransaction>;
}

/** Local manual-test adapter. It never contacts a network and never represents real money. */
export class SandboxManualAdapter implements PaymentAdapter {
  readonly provider = 'SANDBOX_MANUAL';
  readonly capabilities = sandboxManualCapabilities;
  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    assertProviderCapability(this.capabilities, 'createCheckout');
    return {
      provider: 'SANDBOX_MANUAL', environment: 'SANDBOX', mode: 'TEST_ONLY',
      merchantReference: input.merchantReference, redirectUrl: null,
      instructions: 'TEST_ONLY: submit a signed sandbox webhook to /api/v1/payments/webhooks/sandbox. No real payment is collected.'
    };
  }
  async verifyTransaction(_merchantReference: string): Promise<VerifiedTransaction> {
    assertProviderCapability(this.capabilities, 'verifyTransaction');
    throw new Error('SANDBOX_REQUIRES_SIGNED_WEBHOOK_EVIDENCE');
  }
}

export class DisabledLiveAdapter implements PaymentAdapter {
  readonly capabilities = disabledProviderCapabilities;
  constructor(readonly provider: 'SSLCOMMERZ' | 'AAMARPAY' | 'SHURJOPAY') {}
  async createCheckout(_input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    assertProviderCapability(this.capabilities, 'createCheckout');
    throw new Error('PROVIDER_CAPABILITY_DISABLED_createCheckout');
  }
  async verifyTransaction(_merchantReference: string): Promise<VerifiedTransaction> {
    assertProviderCapability(this.capabilities, 'verifyTransaction');
    throw new Error('PROVIDER_CAPABILITY_DISABLED_verifyTransaction');
  }
}
