import { describe, expect, it } from 'vitest';
import { offerExpired, priceDistance, validateSlabs } from '../src/index.js';
const slabs = [{ lowerMeters: 0, upperMeters: 2000, amountMinor: 3000 }, { lowerMeters: 2000, upperMeters: 4000, amountMinor: 4500 }, { lowerMeters: 4000, upperMeters: null, amountMinor: 6000 }];
describe('distance slabs', () => {
  it('uses lower-inclusive upper-exclusive boundary', () => expect(priceDistance(slabs, 2000, 0)).toBe(4500));
  it('applies minimum', () => expect(priceDistance(slabs, 100, 3500)).toBe(3500));
  it('applies maximum', () => expect(priceDistance(slabs, 9000, 0, 5000)).toBe(5000));
  it('rejects gaps', () => expect(() => validateSlabs([{ lowerMeters: 0, upperMeters: 1000, amountMinor: 1 }, { lowerMeters: 1001, upperMeters: null, amountMinor: 2 }])).toThrow('SLAB_GAP_OR_OVERLAP'));
  it('rejects overlaps', () => expect(() => validateSlabs([{ lowerMeters: 0, upperMeters: 2000, amountMinor: 1 }, { lowerMeters: 1000, upperMeters: null, amountMinor: 2 }])).toThrow());
  it('rejects negative distance', () => expect(() => priceDistance(slabs, -1, 0)).toThrow('INVALID_DISTANCE'));
});
describe('offer expiry', () => {
  it('expires exactly at 30 seconds', () => expect(offerExpired('2026-11-01T00:00:30Z', '2026-11-01T00:00:30Z')).toBe(true));
  it('accepts before expiry', () => expect(offerExpired('2026-11-01T00:00:30Z', '2026-11-01T00:00:29Z')).toBe(false));
});
