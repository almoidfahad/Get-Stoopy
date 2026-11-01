export interface Slab { lowerMeters: number; upperMeters: number | null; amountMinor: number; }
export function validateSlabs(slabs: Slab[]): void {
  if (!slabs.length) throw new Error('EMPTY_SLABS');
  const sorted = [...slabs].sort((a, b) => a.lowerMeters - b.lowerMeters);
  let expected = 0;
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    if (!Number.isSafeInteger(s.lowerMeters) || s.lowerMeters < 0 || !Number.isSafeInteger(s.amountMinor) || s.amountMinor < 0) throw new Error('INVALID_SLAB');
    if (s.lowerMeters !== expected) throw new Error('SLAB_GAP_OR_OVERLAP');
    if (s.upperMeters === null) { if (i !== sorted.length - 1) throw new Error('NULL_UPPER_NOT_LAST'); expected = Number.MAX_SAFE_INTEGER; }
    else { if (!Number.isSafeInteger(s.upperMeters) || s.upperMeters <= s.lowerMeters) throw new Error('INVALID_UPPER'); expected = s.upperMeters; }
  }
}
export function priceDistance(slabs: Slab[], distanceMeters: number, minimumMinor: number, maximumMinor?: number): number {
  validateSlabs(slabs);
  if (!Number.isSafeInteger(distanceMeters) || distanceMeters < 0) throw new Error('INVALID_DISTANCE');
  const slab = slabs.find(s => distanceMeters >= s.lowerMeters && (s.upperMeters === null || distanceMeters < s.upperMeters));
  if (!slab) throw new Error('DISTANCE_OUT_OF_RANGE');
  let pay = Math.max(slab.amountMinor, minimumMinor);
  if (maximumMinor !== undefined) pay = Math.min(pay, maximumMinor);
  return pay;
}
export function offerExpired(expiresAt: string, now: string): boolean { return Date.parse(now) >= Date.parse(expiresAt); }
export const OFFER_TTL_SECONDS = 30;
