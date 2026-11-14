import { describe, expect, it } from 'vitest';
import { validateDraftCodOrderPricing } from '../src/cod-order-pricing-draft';
import { MAX_CART_ITEMS, MAX_CHECKOUT_SUBTOTAL_MINOR as MAX } from '../src/checkout';
import type { PricingGroupComponents } from '../src/checkout-pricing';

const group = (groupId: string, deliveryFeeMinor: bigint, changes: Partial<PricingGroupComponents> = {}): PricingGroupComponents => ({
  groupId, currency: 'BDT', productSubtotalMinor: 10000n, productDiscountMinor: 0n, deliveryFeeMinor, taxMinor: 0n, ...changes,
});

describe('unwired COD order delivery cap arithmetic', () => {
  it('checks the total customer delivery charge, not individual store charges', () => {
    const under = validateDraftCodOrderPricing('PURBADHALA_SADAR', [group('store_b', 1000n), group('store_a', 1999n)]);
    expect(under).toMatchObject({ kind: 'DRAFT_VALIDATION_ONLY', area: 'PURBADHALA_SADAR', pricing: { currency: 'BDT', deliveryFeeMinor: 2999n, productSubtotalMinor: 20000n, totalMinor: 22999n } });
    const at = validateDraftCodOrderPricing('PURBADHALA_SADAR', [group('store_b', 1000n), group('store_a', 2000n)]);
    expect(at.pricing.deliveryFeeMinor).toBe(3000n);
    expect(at.pricing.groups.map(g => g.groupId)).toEqual(['store_a', 'store_b']);
    expect(() => validateDraftCodOrderPricing('PURBADHALA_SADAR', [group('store_a', 2000n), group('store_b', 1001n)])).toThrow('COD_DELIVERY_ORDER_CAP_EXCEEDED');
    // Each is within ৳30 individually; their combined charge must still fail.
    expect(() => validateDraftCodOrderPricing('PURBADHALA_SADAR', [group('store_a', 2000n), group('store_b', 2000n)])).toThrow('COD_DELIVERY_ORDER_CAP_EXCEEDED');
    expect(() => validateDraftCodOrderPricing('PURBADHALA_SADAR', [group('store_a', 3001n)])).toThrow('COD_DELIVERY_ORDER_CAP_EXCEEDED');
  });

  it('does not confuse the cap with a cap on product, tax, or total payable', () => {
    const result = validateDraftCodOrderPricing('PURBADHALA_SADAR', [group('a', 3000n, { productSubtotalMinor: 500000n, productDiscountMinor: 1000n, taxMinor: 500n })]);
    expect(result.pricing).toMatchObject({ productSubtotalMinor: 500000n, productDiscountMinor: 1000n, taxMinor: 500n, deliveryFeeMinor: 3000n, totalMinor: 502500n });
    // Product-only discounts do not make an excessive delivery component valid.
    expect(() => validateDraftCodOrderPricing('PURBADHALA_SADAR', [group('a', 3001n, { productDiscountMinor: 10000n })])).toThrow('COD_DELIVERY_ORDER_CAP_EXCEEDED');
  });

  it('requires an explicit supported area and BDT, without inventing a Mymensingh cap', () => {
    for (const area of [null, undefined, '', 'DHAKA', 'purbadhala_sadar', 0, {}]) expect(() => validateDraftCodOrderPricing(area as any, [group('a', 0n)])).toThrow('DELIVERY_AREA_INVALID');
    expect(() => validateDraftCodOrderPricing('PURBADHALA_SADAR', [group('a', 0n, { currency: 'USD' })])).toThrow('COD_PRICING_CURRENCY_INVALID');
    expect(() => validateDraftCodOrderPricing('PURBADHALA_SADAR', [group('a', 0n), group('b', 0n, { currency: 'USD' })])).toThrow('PRICING_CURRENCY_MISMATCH');
    expect(validateDraftCodOrderPricing('MYMENSINGH_CITY', [group('a', 4000n)]).pricing.deliveryFeeMinor).toBe(4000n);
    // Zero is merely a supplied arithmetic input, not an approved free-delivery policy.
    expect(validateDraftCodOrderPricing('PURBADHALA_SADAR', [group('a', 0n)]).pricing.deliveryFeeMinor).toBe(0n);
  });

  it('rejects malformed groups, duplicates, negative values, and overflow', () => {
    expect(() => validateDraftCodOrderPricing('PURBADHALA_SADAR', [])).toThrow('PRICING_GROUP_COUNT_INVALID');
    expect(() => validateDraftCodOrderPricing('PURBADHALA_SADAR', Array.from({ length: MAX_CART_ITEMS + 1 }, (_, i) => group(`g${i}`, 0n)))).toThrow('PRICING_GROUP_COUNT_INVALID');
    expect(() => validateDraftCodOrderPricing('PURBADHALA_SADAR', [group('a', 0n), group('a', 0n)])).toThrow('PRICING_GROUP_DUPLICATE');
    for (const invalid of [-1n, 1, '100', null, undefined, MAX + 1n]) expect(() => validateDraftCodOrderPricing('PURBADHALA_SADAR', [group('a', invalid as any)])).toThrow('PRICING_COMPONENT_INVALID');
    expect(() => validateDraftCodOrderPricing('PURBADHALA_SADAR', [group('a', 0n, { productDiscountMinor: 10001n })])).toThrow('PRICING_DISCOUNT_OR_SUBTOTAL_INVALID');
    expect(() => validateDraftCodOrderPricing('PURBADHALA_SADAR', [group('a', 1n, { productSubtotalMinor: MAX })])).toThrow('PRICING_AMOUNT_LIMIT');
  });

  it('enforces the same cap over up to 50 explicit allocations without mutating input', () => {
    const groups = Array.from({ length: MAX_CART_ITEMS }, (_, i) => group(`g${String(i).padStart(2, '0')}`, 60n));
    const reversed = [...groups].reverse();
    const result = validateDraftCodOrderPricing('PURBADHALA_SADAR', reversed);
    expect(result.pricing.deliveryFeeMinor).toBe(3000n);
    expect(result).toEqual(validateDraftCodOrderPricing('PURBADHALA_SADAR', groups));
    expect(reversed[0]!.groupId).toBe('g49');
    expect(() => validateDraftCodOrderPricing('PURBADHALA_SADAR', [...groups.slice(0, -1), group('g49', 61n)])).toThrow('COD_DELIVERY_ORDER_CAP_EXCEEDED');
  });
});
