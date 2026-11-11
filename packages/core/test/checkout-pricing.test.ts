import { describe, expect, it } from 'vitest';
import { calculatePricingComponents, type PricingGroupComponents } from '../src/checkout-pricing';
import { MAX_CHECKOUT_SUBTOTAL_MINOR, MAX_CART_ITEMS } from '../src/checkout';

const group = (groupId: string, overrides: Partial<PricingGroupComponents> = {}): PricingGroupComponents => ({
  groupId, currency: 'BDT', productSubtotalMinor: 10000n, productDiscountMinor: 1000n, deliveryFeeMinor: 500n, taxMinor: 250n, ...overrides
});

describe('checkout arithmetic-only pricing components', () => {
  it('sums explicitly supplied per-group amounts without inventing a policy', () => {
    const groups = [group('store-b'), group('store-a', { productSubtotalMinor: 5000n, productDiscountMinor: 0n, deliveryFeeMinor: 200n, taxMinor: 0n })];
    const result = calculatePricingComponents(groups);
    expect(result).toEqual({ kind: 'ARITHMETIC_ONLY', currency: 'BDT', groups: [
      { ...groups[1], totalMinor: 5200n }, { ...groups[0], totalMinor: 9750n }
    ], productSubtotalMinor: 15000n, productDiscountMinor: 1000n, deliveryFeeMinor: 700n, taxMinor: 250n, totalMinor: 14950n });
    expect(calculatePricingComponents([...groups].reverse())).toEqual(result);
    expect(groups[0]!.groupId).toBe('store-b'); // does not mutate caller input
  });

  it('requires every component, including explicit zero values', () => {
    const zeroes = group('one', { productDiscountMinor: 0n, deliveryFeeMinor: 0n, taxMinor: 0n });
    expect(calculatePricingComponents([zeroes]).totalMinor).toBe(10000n);
    for (const field of ['productSubtotalMinor', 'productDiscountMinor', 'deliveryFeeMinor', 'taxMinor']) {
      const invalid = { ...zeroes } as any; delete invalid[field];
      expect(() => calculatePricingComponents([invalid])).toThrow('PRICING_COMPONENT_INVALID');
      for (const bad of [null, -1n, 1, '1', Number.NaN, MAX_CHECKOUT_SUBTOTAL_MINOR + 1n]) {
        expect(() => calculatePricingComponents([{ ...zeroes, [field]: bad } as any])).toThrow('PRICING_COMPONENT_INVALID');
      }
    }
  });

  it('rejects invalid groups, duplicates, zero subtotal, oversized discounts and mixed currencies', () => {
    expect(() => calculatePricingComponents([])).toThrow('PRICING_GROUP_COUNT_INVALID');
    expect(() => calculatePricingComponents(Array.from({ length: MAX_CART_ITEMS + 1 }, (_, i) => group(String(i))))).toThrow('PRICING_GROUP_COUNT_INVALID');
    expect(() => calculatePricingComponents([null as any])).toThrow('PRICING_GROUP_INVALID');
    expect(() => calculatePricingComponents([group('bad id')])).toThrow('PRICING_GROUP_INVALID');
    expect(() => calculatePricingComponents([group('a'), group('a')])).toThrow('PRICING_GROUP_DUPLICATE');
    expect(() => calculatePricingComponents([group('a', { currency: 'bdt' })])).toThrow('PRICING_CURRENCY_INVALID');
    expect(() => calculatePricingComponents([group('a'), group('b', { currency: 'USD' })])).toThrow('PRICING_CURRENCY_MISMATCH');
    expect(() => calculatePricingComponents([group('a', { productSubtotalMinor: 0n, productDiscountMinor: 0n })])).toThrow('PRICING_DISCOUNT_OR_SUBTOTAL_INVALID');
    expect(() => calculatePricingComponents([group('a', { productDiscountMinor: 10001n })])).toThrow('PRICING_DISCOUNT_OR_SUBTOTAL_INVALID');
    expect(calculatePricingComponents([group('a', { productDiscountMinor: 10000n, deliveryFeeMinor: 0n, taxMinor: 0n })]).totalMinor).toBe(0n);
  });

  it('uses exact bigint arithmetic and rejects per-group and aggregate signed BIGINT overflow', () => {
    const max = MAX_CHECKOUT_SUBTOTAL_MINOR;
    expect(calculatePricingComponents([group('max', { productSubtotalMinor: max, productDiscountMinor: 0n, deliveryFeeMinor: 0n, taxMinor: 0n })]).totalMinor).toBe(max);
    expect(() => calculatePricingComponents([group('max', { productSubtotalMinor: max, productDiscountMinor: 0n, deliveryFeeMinor: 1n, taxMinor: 0n })])).toThrow('PRICING_AMOUNT_LIMIT');
    expect(() => calculatePricingComponents([group('a', { productSubtotalMinor: max, productDiscountMinor: max, deliveryFeeMinor: 0n, taxMinor: 0n }), group('b', { productSubtotalMinor: 1n, productDiscountMinor: 1n, deliveryFeeMinor: 0n, taxMinor: 0n })])).toThrow('PRICING_AMOUNT_LIMIT');
    expect(() => calculatePricingComponents([group('a', { productSubtotalMinor: 1n, productDiscountMinor: 1n, deliveryFeeMinor: max, taxMinor: 0n }), group('b', { productSubtotalMinor: 1n, productDiscountMinor: 1n, deliveryFeeMinor: 1n, taxMinor: 0n })])).toThrow('PRICING_AMOUNT_LIMIT');
  });

  it('preserves group/parent sums for many valid multi-store inputs', () => {
    for (let count = 1; count <= MAX_CART_ITEMS; count++) {
      const input = Array.from({ length: count }, (_, i) => group(`g${i}`, { productSubtotalMinor: BigInt(100 + i * 3), productDiscountMinor: BigInt(i), deliveryFeeMinor: BigInt(i % 7), taxMinor: BigInt(i % 4) }));
      const result = calculatePricingComponents(input);
      expect(result.totalMinor).toBe(result.groups.reduce((sum, row) => sum + row.totalMinor, 0n));
      expect(result.totalMinor).toBe(result.productSubtotalMinor - result.productDiscountMinor + result.deliveryFeeMinor + result.taxMinor);
      expect(result.productSubtotalMinor).toBe(input.reduce((sum, row) => sum + row.productSubtotalMinor, 0n));
    }
  });
});
