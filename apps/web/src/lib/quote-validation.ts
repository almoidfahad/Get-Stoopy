import type { QuoteInput } from '@getstoopy/core/browser';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: unknown): value is string { return typeof value === 'string' && UUID_RE.test(value); }

// Validate the fields the checkout panel renders and the IDs used for routing;
// this does not authorize a quote or prove that stock is held.
export function isQuoteInput(value: unknown): value is QuoteInput {
  if (!value || typeof value !== 'object') return false;
  const q = value as Record<string, unknown>;
  if (!isUuid(q.quoteId) || !isUuid(q.cartId) ||
      typeof q.state !== 'string' || !['RESERVED', 'RELEASED', 'EXPIRED', 'CONSUMED'].includes(q.state) ||
      !Number.isSafeInteger(q.version) || (q.version as number) < 1 || typeof q.currency !== 'string' ||
      !isUuid(q.destinationCityId) || typeof q.subtotalMinor !== 'string' || typeof q.expiresAt !== 'string' ||
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
