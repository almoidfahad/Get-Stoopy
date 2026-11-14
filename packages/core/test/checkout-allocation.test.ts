import { describe, expect, it } from 'vitest';
import { allocateCheckoutAmount } from '../src/checkout-allocation';
import { calculatePricingComponents } from '../src/checkout-pricing';
import { MAX_CART_ITEMS, MAX_CHECKOUT_SUBTOTAL_MINOR as MAX } from '../src/checkout';

describe('isolated checkout allocation arithmetic', () => {
  it('uses largest remainders with a stable ID tie-breaker independent of input order', () => {
    const weights = [{ groupId: 'c', weight: 1n }, { groupId: 'a', weight: 1n }, { groupId: 'b', weight: 1n }];
    const expected = { kind: 'ARITHMETIC_ONLY', totalMinor: 2n, groups: [
      { groupId: 'a', weight: 1n, amountMinor: 1n },
      { groupId: 'b', weight: 1n, amountMinor: 1n },
      { groupId: 'c', weight: 1n, amountMinor: 0n }
    ] };
    expect(allocateCheckoutAmount(2n, weights)).toEqual(expected);
    expect(allocateCheckoutAmount(2n, [...weights].reverse())).toEqual(expected);
    expect(weights.map(w => w.groupId)).toEqual(['c', 'a', 'b']);
    expect(allocateCheckoutAmount(7n, [{ groupId: 'a', weight: 1n }, { groupId: 'b', weight: 2n }]).groups.map(g => g.amountMinor)).toEqual([2n, 5n]);
  });

  it('requires explicit valid bounded amounts, canonical unique IDs and positive total weight', () => {
    for (const total of [undefined, null, -1n, 0, '1', MAX + 1n]) expect(() => allocateCheckoutAmount(total as any, [{ groupId: 'a', weight: 1n }])).toThrow('ALLOCATION_TOTAL_INVALID');
    expect(() => allocateCheckoutAmount(1n, [])).toThrow('ALLOCATION_GROUP_COUNT_INVALID');
    expect(() => allocateCheckoutAmount(1n, Array.from({ length: MAX_CART_ITEMS + 1 }, (_, i) => ({ groupId: `g${i}`, weight: 1n })))).toThrow('ALLOCATION_GROUP_COUNT_INVALID');
    for (const entry of [null, {}, { groupId: 'A', weight: 1n }, { groupId: 'private name', weight: 1n }, { groupId: 'a'.repeat(129), weight: 1n }]) expect(() => allocateCheckoutAmount(1n, [entry as any])).toThrow('ALLOCATION_GROUP_INVALID');
    expect(() => allocateCheckoutAmount(1n, [{ groupId: 'a', weight: 1n }, { groupId: 'a', weight: 2n }])).toThrow('ALLOCATION_GROUP_DUPLICATE');
    for (const weight of [undefined, null, -1n, 0, '1', MAX + 1n]) expect(() => allocateCheckoutAmount(1n, [{ groupId: 'a', weight } as any])).toThrow('ALLOCATION_WEIGHT_INVALID');
    expect(() => allocateCheckoutAmount(0n, [{ groupId: 'a', weight: 0n }])).toThrow('ALLOCATION_ZERO_WEIGHT');
    expect(allocateCheckoutAmount(0n, [{ groupId: 'a', weight: 1n }, { groupId: 'b', weight: 0n }]).groups.map(g => g.amountMinor)).toEqual([0n, 0n]);
    expect(allocateCheckoutAmount(1n, [{ groupId: 'a', weight: 0n }, { groupId: 'b', weight: 1n }]).groups.map(g => g.amountMinor)).toEqual([0n, 1n]);
  });

  it('handles sums and products larger than signed BIGINT without losing precision', () => {
    const weights = [{ groupId: 'b', weight: MAX }, { groupId: 'a', weight: MAX }, { groupId: 'c', weight: MAX }];
    const result = allocateCheckoutAmount(MAX, weights);
    expect(result.groups.reduce((acc, g) => acc + g.amountMinor, 0n)).toBe(MAX);
    const eachFloor = MAX / 3n;
    expect(result.groups.map(g => g.amountMinor)).toEqual([eachFloor + 1n, eachFloor, eachFloor]);
  });

  it('conserves every minor unit and stays within floor/ceiling for 1–50 groups', () => {
    for (let count = 1; count <= MAX_CART_ITEMS; count++) {
      const weights = Array.from({ length: count }, (_, i) => ({ groupId: `group_${String(i).padStart(2, '0')}`, weight: BigInt((i * 13 + count) % 47) }));
      if (weights.every(w => w.weight === 0n)) weights[0]!.weight = 1n;
      const sum = weights.reduce((acc, w) => acc + w.weight, 0n);
      for (const total of [0n, 1n, 17n, 10001n, MAX]) {
        const result = allocateCheckoutAmount(total, weights);
        expect(result.groups.reduce((acc, g) => acc + g.amountMinor, 0n)).toBe(total);
        expect(allocateCheckoutAmount(total, [...weights].reverse())).toEqual(result);
        for (const row of result.groups) {
          const numerator = total * row.weight;
          const floor = numerator / sum;
          expect(row.amountMinor === floor || (numerator % sum !== 0n && row.amountMinor === floor + 1n)).toBe(true);
          if (row.weight === 0n) expect(row.amountMinor).toBe(0n);
        }
      }
    }
  });

  it('can reconcile an explicitly allocated synthetic product discount against arithmetic groups', () => {
    const subtotals = [{ groupId: 'a', weight: 101n }, { groupId: 'b', weight: 202n }, { groupId: 'c', weight: 303n }];
    const allocated = allocateCheckoutAmount(13n, subtotals);
    const result = calculatePricingComponents(allocated.groups.map(g => ({ groupId: g.groupId, currency: 'BDT', productSubtotalMinor: g.weight, productDiscountMinor: g.amountMinor, deliveryFeeMinor: 0n, taxMinor: 0n })));
    expect(result.productSubtotalMinor).toBe(606n);
    expect(result.productDiscountMinor).toBe(13n);
    expect(result.totalMinor).toBe(593n);
  });
});
