import { describe, expect, it } from 'vitest';
import { draftCodDeliveryFee, draftCodDistanceTier } from '../src/cod-delivery-fee-draft';

describe('unwired COD delivery fee amount lookup', () => {
  it.each([
    ['MYMENSINGH_CITY', 'NEAR', 2000n], ['MYMENSINGH_CITY', 'MEDIUM', 3000n], ['MYMENSINGH_CITY', 'FAR', 4000n],
    ['PURBADHALA_SADAR', 'NEAR', 2000n], ['PURBADHALA_SADAR', 'MEDIUM', 2500n], ['PURBADHALA_SADAR', 'FAR', 3000n],
  ] as const)('returns specified BDT paisa for %s, %s', (area, tier, feeMinor) => {
    expect(draftCodDeliveryFee(area, tier)).toEqual({ kind: 'DRAFT_AMOUNT_ONLY', currency: 'BDT', feeMinor });
  });
  it('rejects unspecified or invented areas and tiers without a default', () => {
    for (const invalid of [null, undefined, '', 'purbadhala_sadar', 'DHAKA', '__proto__', 0, {}]) {
      expect(() => draftCodDeliveryFee(invalid as any, 'NEAR')).toThrow('DELIVERY_AREA_INVALID');
      expect(() => draftCodDeliveryFee('MYMENSINGH_CITY', invalid as any)).toThrow('DELIVERY_TIER_INVALID');
    }
  });
  it('never returns more than ৳30 for any of the specified Purbadhala tiers', () => {
    for (const tier of ['NEAR', 'MEDIUM', 'FAR'] as const) expect(draftCodDeliveryFee('PURBADHALA_SADAR', tier).feeMinor).toBeLessThanOrEqual(3000n);
  });
  it.each([
    [0, 'NEAR', 2000n, 2000n], [1000, 'NEAR', 2000n, 2000n],
    [1001, 'MEDIUM', 3000n, 2500n], [2000, 'MEDIUM', 3000n, 2500n],
    [2001, 'FAR', 4000n, 3000n], [3000, 'FAR', 4000n, 3000n],
  ] as const)('classifies %i meters at the specified inclusive boundaries', (meters, tier, mymensinghFee, purbadhalaFee) => {
    expect(draftCodDistanceTier(meters)).toBe(tier);
    expect(draftCodDeliveryFee('MYMENSINGH_CITY', draftCodDistanceTier(meters)).feeMinor).toBe(mymensinghFee);
    expect(draftCodDeliveryFee('PURBADHALA_SADAR', draftCodDistanceTier(meters)).feeMinor).toBe(purbadhalaFee);
  });
  it('rejects missing, invalid and out-of-range distances, without rounding or fallback', () => {
    for (const bad of [-1, 1.1, Number.NaN, Infinity, -Infinity, null, undefined, '1000', {}, Number.MAX_SAFE_INTEGER + 1]) expect(() => draftCodDistanceTier(bad as any)).toThrow('DELIVERY_DISTANCE_INVALID');
    for (const bad of [3001, 1000000]) expect(() => draftCodDistanceTier(bad)).toThrow('DELIVERY_DISTANCE_OUT_OF_RANGE');
  });
});
