export interface RateSlab { lowerMeters: number; upperMeters: number | null; amountMinor: bigint; }
export function validateRateSlabs(slabs: readonly RateSlab[]): void {
  if (!slabs.length || slabs.length > 50) throw new Error('RATE_SLABS_INVALID');
  const sorted = [...slabs].sort((a, b) => a.lowerMeters - b.lowerMeters);
  let expected = 0; let open = 0;
  for (const s of sorted) {
    if (!Number.isSafeInteger(s.lowerMeters) || s.lowerMeters !== expected) throw new Error('RATE_SLABS_GAP');
    if (typeof s.amountMinor !== 'bigint' || s.amountMinor <= 0n) throw new Error('RATE_SLAB_AMOUNT_INVALID');
    if (s.upperMeters === null) { open++; expected = Number.MAX_SAFE_INTEGER; }
    else {
      if (!Number.isSafeInteger(s.upperMeters) || s.upperMeters <= s.lowerMeters) throw new Error('RATE_SLAB_BOUNDS_INVALID');
      expected = s.upperMeters;
    }
  }
  if (open !== 1 || sorted[sorted.length - 1]!.upperMeters !== null) throw new Error('RATE_SLABS_INVALID');
}
export function rateForDistance(slabs: readonly RateSlab[], meters: number): RateSlab {
  if (!Number.isSafeInteger(meters) || meters < 0) throw new Error('RATE_DISTANCE_INVALID');
  const slab = slabs.find(s => meters >= s.lowerMeters && (s.upperMeters === null || meters < s.upperMeters));
  if (!slab) throw new Error('RATE_DISTANCE_OUT_OF_RANGE');
  return slab;
}
export function codDueMinor(collected: bigint, verifiedAllocated: bigint): bigint {
  if (collected < 0n || verifiedAllocated < 0n || verifiedAllocated > collected) throw new Error('COD_BALANCE_INVALID');
  return collected - verifiedAllocated;
}
