import { describe, expect, it } from 'vitest';
import { codDueMinor, rateForDistance, validateRateSlabs } from '../src/index.js';

describe('rider finance pure policy', () => {
  const slabs = [ { lowerMeters: 0, upperMeters: 2000, amountMinor: 6000n }, { lowerMeters: 2000, upperMeters: 4000, amountMinor: 9000n }, { lowerMeters: 4000, upperMeters: null, amountMinor: 12000n } ];
  it('requires contiguous lower-inclusive/upper-exclusive slabs with one open end', () => {
    expect(() => validateRateSlabs(slabs)).not.toThrow();
    expect(() => validateRateSlabs([{ lowerMeters: 0, upperMeters: 1000, amountMinor: 1n }, { lowerMeters: 2000, upperMeters: null, amountMinor: 2n }])).toThrow('RATE_SLABS_GAP');
    expect(() => validateRateSlabs([{ lowerMeters: 0, upperMeters: null, amountMinor: 1n }, { lowerMeters: 1000, upperMeters: null, amountMinor: 2n }])).toThrow();
    expect(() => validateRateSlabs([])).toThrow('RATE_SLABS_INVALID');
  });
  it('selects the slab by road distance without straight-line fallback', () => {
    expect(rateForDistance(slabs, 1999).amountMinor).toBe(6000n);
    expect(rateForDistance(slabs, 2000).amountMinor).toBe(9000n);
    expect(rateForDistance(slabs, 5000).amountMinor).toBe(12000n);
    expect(() => rateForDistance(slabs, -1)).toThrow('RATE_DISTANCE_INVALID');
  });
  it('keeps COD due separate and never negative', () => {
    expect(codDueMinor(1050n, 400n)).toBe(650n);
    expect(codDueMinor(1050n, 1050n)).toBe(0n);
    expect(() => codDueMinor(100n, 101n)).toThrow('COD_BALANCE_INVALID');
  });
});
