export const DELIVERY_OTP_CHANNEL = Symbol('DELIVERY_OTP_CHANNEL');
export const TEST_DELIVERY_OTP_SINK = Symbol('TEST_DELIVERY_OTP_SINK');

export interface DeliveryOtpDelivery { challengeId: string; phoneE164: string; code: string; expiresAt: Date; }
export interface DeliveryOtpChannel { readonly channel: string; send(input: DeliveryOtpDelivery): Promise<{ receipt: string }>; }

export class DisabledDeliveryOtpChannel implements DeliveryOtpChannel {
  readonly channel = 'disabled';
  async send(_input: DeliveryOtpDelivery): Promise<{ receipt: string }> { throw new Error('DELIVERY_OTP_CHANNEL_DISABLED'); }
}

/** In-process test sink only. It is never exposed through HTTP and is forbidden outside NODE_ENV=test. */
export class TestDeliveryOtpSink {
  private readonly codes = new Map<string, { code: string; expiresAt: Date }>();
  record(input: DeliveryOtpDelivery): void { this.codes.set(input.challengeId, { code: input.code, expiresAt: input.expiresAt }); }
  consume(challengeId: string): string | null {
    const entry = this.codes.get(challengeId);
    if (!entry) return null;
    this.codes.delete(challengeId);
    return entry.expiresAt > new Date() ? entry.code : null;
  }
}
export class TestDeliveryOtpChannel implements DeliveryOtpChannel {
  readonly channel = 'test';
  constructor(private readonly sink: TestDeliveryOtpSink) {}
  async send(input: DeliveryOtpDelivery): Promise<{ receipt: string }> { this.sink.record(input); return { receipt: `test-${input.challengeId}` }; }
}
