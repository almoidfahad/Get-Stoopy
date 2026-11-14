import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from '../../../apps/api/src/payments/orders.service';

describe('subtotal-only order creation gate', () => {
  it.each(['development', 'staging', 'production', undefined, 'unexpected'])('blocks %s before accessing the database regardless of payment method', async nodeEnv => {
    const transaction = vi.fn();
    const env = { NODE_ENV: nodeEnv, PAYMENTS_SANDBOX_ENABLED: true, PAYMENTS_LIVE_ENABLED: true };
    const service = new OrdersService({ $transaction: transaction } as any, {} as any, {} as any, env as any);
    for (const paymentMethod of ['COD', 'SANDBOX_MANUAL'] as const) {
      await expect(service.createFromQuote({ userId: 'buyer' } as any, { quoteId: 'quote', expectedQuoteVersion: 1, commandKey: 'test-key-123', paymentMethod })).rejects.toMatchObject({
        status: 503, response: { code: 'ORDER_CREATION_DISABLED' }
      });
    }
    expect(transaction).not.toHaveBeenCalled();
  });
});
