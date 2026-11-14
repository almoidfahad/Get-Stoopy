import { describe, expect, it } from 'vitest';
import { assertCartItemCount, assertCartQuantity, assertCheckoutQuoteTransition, groupQuoteItems, lineTotalMinor, MAX_CART_ITEMS, MAX_CHECKOUT_SUBTOTAL_MINOR } from '../src/checkout.js';

describe('checkout quote primitives', () => {
  it('bounds cart quantities and item counts', () => {
    expect(() => assertCartQuantity(0)).toThrow('CART_QUANTITY_INVALID');
    expect(() => assertCartQuantity(101)).toThrow('CART_QUANTITY_INVALID');
    expect(() => assertCartQuantity(1.5)).toThrow('CART_QUANTITY_INVALID');
    expect(() => assertCartQuantity(100)).not.toThrow();
    expect(() => assertCartItemCount(MAX_CART_ITEMS + 1)).toThrow('CART_ITEM_LIMIT');
  });

  it('computes exact bigint line totals', () => {
    expect(lineTotalMinor(199n, 3)).toBe(597n);
    expect(lineTotalMinor(9_007_199_254_740_991n, 100)).toBe(900_719_925_474_099_100n);
    expect(() => lineTotalMinor(0n, 1)).toThrow('PRICE_MINOR_INVALID');
  });

  it('groups by vendor/store deterministically and sums without rounding loss', () => {
    const result = groupQuoteItems([
      { variantId: 'v3', vendorId: 'b', storeId: 's2', currency: 'BDT', quantity: 2, unitPriceMinor: 150n },
      { variantId: 'v1', vendorId: 'a', storeId: 's1', currency: 'BDT', quantity: 1, unitPriceMinor: 100n },
      { variantId: 'v2', vendorId: 'a', storeId: 's1', currency: 'BDT', quantity: 3, unitPriceMinor: 250n }
    ]);
    expect(result.currency).toBe('BDT');
    expect(result.subtotalMinor).toBe(1150n);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]).toMatchObject({ vendorId: 'a', storeId: 's1', subtotalMinor: 850n, variantIds: ['v1', 'v2'] });
    expect(result.groups[1]).toMatchObject({ vendorId: 'b', storeId: 's2', subtotalMinor: 300n });
  });

  it('bounds line and aggregate amounts at signed PostgreSQL bigint', () => {
    expect(lineTotalMinor(MAX_CHECKOUT_SUBTOTAL_MINOR, 1)).toBe(MAX_CHECKOUT_SUBTOTAL_MINOR);
    expect(() => lineTotalMinor(MAX_CHECKOUT_SUBTOTAL_MINOR + 1n, 1)).toThrow('CHECKOUT_SUBTOTAL_LIMIT');
    const item = { variantId: 'v1', vendorId: 'a', storeId: 's1', currency: 'BDT', quantity: 1, unitPriceMinor: MAX_CHECKOUT_SUBTOTAL_MINOR - 1n };
    expect(groupQuoteItems([item, { ...item, variantId: 'v2', unitPriceMinor: 1n }]).subtotalMinor).toBe(MAX_CHECKOUT_SUBTOTAL_MINOR);
    expect(() => groupQuoteItems([item, { ...item, variantId: 'v2', vendorId: 'b', unitPriceMinor: 2n }])).toThrow('CHECKOUT_SUBTOTAL_LIMIT');
    // Each real catalog price and line is valid; their combined subtotal is not.
    const expensive = Array.from({ length: 11 }, (_, i) => ({ ...item, variantId: `v${i}`, quantity: 100, unitPriceMinor: 9_007_199_254_740_991n }));
    expect(() => groupQuoteItems(expensive)).toThrow('CHECKOUT_SUBTOTAL_LIMIT');
    expect(groupQuoteItems(expensive.slice(0, 10)).subtotalMinor).toBe(9_007_199_254_740_991_000n);
  });

  it('rejects empty carts, duplicate variants and mixed currencies', () => {
    expect(() => groupQuoteItems([])).toThrow('CART_EMPTY_OR_LIMIT');
    const item = { variantId: 'v1', vendorId: 'a', storeId: 's1', currency: 'BDT', quantity: 1, unitPriceMinor: 100n };
    expect(() => groupQuoteItems([item, item])).toThrow('CART_VARIANT_DUPLICATE');
    expect(() => groupQuoteItems([item, { ...item, variantId: 'v2', currency: 'USD' }])).toThrow('CURRENCY_MISMATCH');
  });

  it('enforces terminal quote transitions', () => {
    expect(() => assertCheckoutQuoteTransition('RESERVED', 'RELEASED')).not.toThrow();
    expect(() => assertCheckoutQuoteTransition('RESERVED', 'EXPIRED')).not.toThrow();
    expect(() => assertCheckoutQuoteTransition('RELEASED', 'RESERVED')).toThrow('CHECKOUT_QUOTE_INVALID_TRANSITION');
    expect(() => assertCheckoutQuoteTransition('EXPIRED', 'RELEASED')).toThrow('CHECKOUT_QUOTE_INVALID_TRANSITION');
  });
});
