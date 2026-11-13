import { describe, expect, it } from 'vitest';
import { draftHighestCodDeliveryFee } from '../src/cod-delivery-order-fee-draft';
import { MAX_CART_ITEMS } from '../src/checkout';

const delivery = (deliveryId: string, distanceMeters: number) => ({ deliveryId, distanceMeters });

describe('unwired highest-slab-once COD order fee', () => {
  it.each([
    ['MYMENSINGH_CITY', [1000, 2000, 3000], [2000n, 3000n, 4000n], 4000n],
    ['PURBADHALA_SADAR', [1000, 2000, 3000], [2000n, 2500n, 3000n], 3000n],
    ['PURBADHALA_SADAR', [500, 1500], [2000n, 2500n], 2500n],
    ['MYMENSINGH_CITY', [500, 500], [2000n, 2000n], 2000n],
  ] as const)('selects one highest fee for %s and checks every delivery', (area, meters, fees, total) => {
    const input = meters.map((distance, i) => delivery(`d${i}`, distance));
    const result = draftHighestCodDeliveryFee(area, input);
    expect(result).toMatchObject({ kind: 'DRAFT_AMOUNT_ONLY', area, currency: 'BDT', deliveryFeeMinor: total });
    expect(result.deliveries.map(x => x.tierFeeMinor)).toEqual(fees);
    expect(draftHighestCodDeliveryFee(area, [...input].reverse())).toEqual(result);
  });

  it.each([
    [0, 'NEAR', 2000n], [1000, 'NEAR', 2000n], [1001, 'MEDIUM', 2500n],
    [2000, 'MEDIUM', 2500n], [2001, 'FAR', 3000n], [3000, 'FAR', 3000n],
  ] as const)('uses the specified single-delivery boundaries at %i meters', (meters, tier, fee) => {
    const result = draftHighestCodDeliveryFee('PURBADHALA_SADAR', [delivery('delivery', meters)]);
    expect(result.deliveryFeeMinor).toBe(fee);
    expect(result.deliveries[0]).toEqual({ deliveryId: 'delivery', distanceMeters: meters, tier, tierFeeMinor: fee });
  });

  it('rejects the whole calculation when any rider delivery exceeds 3 km or is invalid', () => {
    for (const invalid of [-1, 1.1, NaN, Infinity, null, undefined, '1000', Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => draftHighestCodDeliveryFee('PURBADHALA_SADAR', [delivery('a', 1000), delivery('b', invalid as any)])).toThrow('DELIVERY_DISTANCE_INVALID');
    }
    for (const invalid of [3001, 9000]) expect(() => draftHighestCodDeliveryFee('MYMENSINGH_CITY', [delivery('a', 1), delivery('b', invalid)])).toThrow('DELIVERY_DISTANCE_OUT_OF_RANGE');
  });

  it('requires explicit area, delivery set and unique non-sensitive IDs', () => {
    for (const area of [null, undefined, 'DHAKA', 'purbadhala_sadar', {}]) expect(() => draftHighestCodDeliveryFee(area as any, [delivery('a', 10)])).toThrow('DELIVERY_AREA_INVALID');
    for (const rows of [null, undefined, [], Array.from({ length: MAX_CART_ITEMS + 1 }, (_, i) => delivery(`d${i}`, 10))]) expect(() => draftHighestCodDeliveryFee('PURBADHALA_SADAR', rows as any)).toThrow('DELIVERY_COUNT_INVALID');
    for (const id of [null, undefined, '', 'RIDER', 'person name', '__bad!__', 'x'.repeat(129)]) expect(() => draftHighestCodDeliveryFee('PURBADHALA_SADAR', [delivery(id as any, 10)])).toThrow('DELIVERY_ID_INVALID');
    expect(() => draftHighestCodDeliveryFee('PURBADHALA_SADAR', [delivery('a', 10), delivery('a', 2000)])).toThrow('DELIVERY_ID_DUPLICATE');
    expect(() => draftHighestCodDeliveryFee('PURBADHALA_SADAR', new Array(1))).toThrow('DELIVERY_ID_INVALID');
  });

  it('charges only one maximum across up to 50 inputs and does not mutate inputs', () => {
    const inputs = Array.from({ length: MAX_CART_ITEMS }, (_, i) => delivery(`d${String(i).padStart(2, '0')}`, i === 49 ? 3000 : 1000)).reverse();
    const result = draftHighestCodDeliveryFee('PURBADHALA_SADAR', inputs);
    expect(result.deliveryFeeMinor).toBe(3000n);
    expect(result.deliveries).toHaveLength(MAX_CART_ITEMS);
    expect(inputs[0]).toEqual(delivery('d49', 3000));
    expect(result.deliveries[0]!.deliveryId).toBe('d00');
  });
});
