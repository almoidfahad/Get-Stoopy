export type CheckoutQuoteState = 'RESERVED' | 'RELEASED' | 'EXPIRED';

export const MAX_CART_ITEMS = 50;
export const MAX_CART_LINE_QUANTITY = 100;
export const MAX_ACTIVE_QUOTES_PER_USER = 5;
export const CHECKOUT_QUOTE_TTL_SECONDS = 900;
// Quote totals and line amounts are persisted as PostgreSQL signed BIGINT.
export const MAX_CHECKOUT_SUBTOTAL_MINOR = 9_223_372_036_854_775_807n;

export const checkoutQuoteTransitions: Record<CheckoutQuoteState, CheckoutQuoteState[]> = {
  RESERVED: ['RELEASED', 'EXPIRED'],
  RELEASED: [],
  EXPIRED: []
};

export function assertCheckoutQuoteTransition(from: CheckoutQuoteState, to: CheckoutQuoteState): void {
  if (!(checkoutQuoteTransitions[from] ?? []).includes(to)) throw new Error(`CHECKOUT_QUOTE_INVALID_TRANSITION_${from}_${to}`);
}

export function assertCartQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CART_LINE_QUANTITY) throw new Error('CART_QUANTITY_INVALID');
}

export function assertCartItemCount(count: number): void {
  if (!Number.isInteger(count) || count < 0 || count > MAX_CART_ITEMS) throw new Error('CART_ITEM_LIMIT');
}

export function lineTotalMinor(unitPriceMinor: bigint, quantity: number): bigint {
  assertCartQuantity(quantity);
  if (unitPriceMinor <= 0n) throw new Error('PRICE_MINOR_INVALID');
  const line = unitPriceMinor * BigInt(quantity);
  if (line > MAX_CHECKOUT_SUBTOTAL_MINOR) throw new Error('CHECKOUT_SUBTOTAL_LIMIT');
  return line;
}

export interface QuotePricedItem {
  variantId: string;
  vendorId: string;
  storeId: string;
  currency: string;
  quantity: number;
  unitPriceMinor: bigint;
}

export interface QuoteGroupTotal {
  vendorId: string;
  storeId: string;
  currency: string;
  subtotalMinor: bigint;
  variantIds: string[];
}

/** Deterministic vendor/store grouping. Client-supplied totals are never accepted. */
export function groupQuoteItems(items: QuotePricedItem[]): { groups: QuoteGroupTotal[]; subtotalMinor: bigint; currency: string } {
  if (!items.length || items.length > MAX_CART_ITEMS) throw new Error('CART_EMPTY_OR_LIMIT');
  const currency = items[0]!.currency;
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('INVALID_CURRENCY');
  const sorted = [...items].sort((a, b) => a.variantId.localeCompare(b.variantId));
  const seen = new Set<string>();
  const map = new Map<string, QuoteGroupTotal>();
  let subtotal = 0n;
  for (const item of sorted) {
    if (seen.has(item.variantId)) throw new Error('CART_VARIANT_DUPLICATE');
    seen.add(item.variantId);
    if (item.currency !== currency) throw new Error('CURRENCY_MISMATCH');
    const line = lineTotalMinor(item.unitPriceMinor, item.quantity);
    subtotal += line;
    if (subtotal > MAX_CHECKOUT_SUBTOTAL_MINOR) throw new Error('CHECKOUT_SUBTOTAL_LIMIT');
    const key = `${item.vendorId}:${item.storeId}`;
    const group = map.get(key) ?? { vendorId: item.vendorId, storeId: item.storeId, currency, subtotalMinor: 0n, variantIds: [] };
    group.subtotalMinor += line;
    group.variantIds.push(item.variantId);
    map.set(key, group);
  }
  const groups = [...map.values()].sort((a, b) => `${a.vendorId}:${a.storeId}`.localeCompare(`${b.vendorId}:${b.storeId}`));
  return { groups, subtotalMinor: subtotal, currency };
}
