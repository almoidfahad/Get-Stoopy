import type { QuoteInput } from '@getstoopy/core/browser';

// Validate the fields the checkout panel renders; this does not authorize a quote.
export function isQuoteInput(value: unknown): value is QuoteInput {
  if (!value || typeof value !== 'object') return false;
  const q = value as Record<string, unknown>;
  if (typeof q.quoteId !== 'string' || !q.quoteId || typeof q.cartId !== 'string' || !q.cartId ||
      typeof q.state !== 'string' || !['RESERVED', 'RELEASED', 'EXPIRED', 'CONSUMED'].includes(q.state) ||
      !Number.isSafeInteger(q.version) || (q.version as number) < 1 || typeof q.currency !== 'string' ||
      typeof q.destinationCityId !== 'string' || !q.destinationCityId || typeof q.subtotalMinor !== 'string' || typeof q.expiresAt !== 'string' ||
      !(q.closedAt === null || typeof q.closedAt === 'string') || !(q.deliveryFeeMinor === null || typeof q.deliveryFeeMinor === 'string') ||
      !(q.totalMinor === null || typeof q.totalMinor === 'string') || typeof q.paymentStatus !== 'string' ||
      !Array.isArray(q.items) || !Array.isArray(q.groups)) return false;
  return q.items.every((value: unknown) => {
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    return typeof item.itemId === 'string' && typeof item.groupId === 'string' && typeof item.variantId === 'string' &&
      typeof item.productTitle === 'string' && typeof item.quantity === 'number' && Number.isFinite(item.quantity) &&
      typeof item.unitPriceMinor === 'string' && typeof item.lineTotalMinor === 'string' && typeof item.currency === 'string';
  }) && q.groups.every((value: unknown) => {
    if (!value || typeof value !== 'object') return false;
    const group = value as Record<string, unknown>;
    return typeof group.groupId === 'string' && typeof group.storeId === 'string' &&
      typeof group.subtotalMinor === 'string' && typeof group.currency === 'string';
  });
}
