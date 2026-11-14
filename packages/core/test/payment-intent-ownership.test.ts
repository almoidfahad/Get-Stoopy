import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsService } from '../../../apps/api/src/payments/payments.service';

const orderId = '11111111-1111-4111-8111-111111111111';
const buyerId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const commandKey = 'same-command-key';
const payloadHash = createHash('sha256').update(JSON.stringify({ orderId, provider: 'SANDBOX_MANUAL' })).digest('hex');
const intent = { id: 'intent', orderId, userId: buyerId, payloadHash, merchantReference: 'PI-ref', provider: 'SANDBOX_MANUAL', environment: 'SANDBOX', amountMinor: 1000n, currency: 'BDT', status: 'VERIFIED', providerReference: null, verificationMethod: 'SANDBOX_HMAC_WEBHOOK', expiresAt: new Date(), closedAt: new Date(), version: 2 };

function fixture(order: unknown, existing: unknown = intent) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue(order ? [order] : []),
    paymentIntent: { findUnique: vi.fn().mockResolvedValue(existing), findFirst: vi.fn(), create: vi.fn() }
  };
  const service = new PaymentsService({ $transaction: (fn: any) => fn(tx) } as any, { PAYMENTS_SANDBOX_ENABLED: true, PAYMENT_SANDBOX_WEBHOOK_SECRET: 'test-secret', PAYMENTS_LIVE_ENABLED: false } as any, {} as any);
  return { service, tx };
}

describe('payment intent replay ownership', () => {
  it('checks buyer ownership under the order lock before any replay lookup', async () => {
    const { service, tx } = fixture(null);
    await expect(service.createIntent({ userId: otherId, authorizationVersion: 1 } as any, orderId, { commandKey })).rejects.toMatchObject({ status: 404, response: { code: 'ORDER_NOT_FOUND' } });
    const [strings, ...values] = tx.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toMatch(/"buyerId"\s*=\s*\?::uuid\s+FOR UPDATE/);
    expect(values).toEqual([orderId, otherId]);
    expect(tx.paymentIntent.findUnique).not.toHaveBeenCalled();
    expect(tx.paymentIntent.create).not.toHaveBeenCalled();
  });

  it('returns a same-buyer duplicate even after the order is no longer payable', async () => {
    const { service, tx } = fixture({ id: orderId, buyerId, paymentMethod: 'SANDBOX_MANUAL', paymentStatus: 'PAYMENT_VERIFIED' });
    const result = await service.createIntent({ userId: buyerId, authorizationVersion: 1 } as any, orderId, { commandKey });
    expect(result).toMatchObject({ intentId: intent.id, status: 'VERIFIED', duplicate: true, amountMinor: '1000' });
    expect(tx.paymentIntent.findUnique).toHaveBeenCalledOnce();
    expect(tx.paymentIntent.findFirst).not.toHaveBeenCalled();
    expect(tx.paymentIntent.create).not.toHaveBeenCalled();
  });

  it('rejects a conflicting replay after authorizing the owner', async () => {
    const { service, tx } = fixture({ id: orderId, buyerId, paymentMethod: 'SANDBOX_MANUAL', paymentStatus: 'AWAITING_PAYMENT' }, { ...intent, payloadHash: 'different' });
    await expect(service.createIntent({ userId: buyerId, authorizationVersion: 1 } as any, orderId, { commandKey })).rejects.toMatchObject({ status: 409, response: { code: 'PAYMENT_IDEMPOTENCY_CONFLICT' } });
    expect(tx.paymentIntent.create).not.toHaveBeenCalled();
  });
});
