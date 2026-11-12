import { describe, expect, it } from 'vitest';
import { draftCodDeliveryFee } from '../src/cod-delivery-fee-draft';

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
});
