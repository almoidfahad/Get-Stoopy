/**
 * Arithmetic-only candidate allocator. Not an approved financial policy,
 * quote, refund rule, or authorization to move money. Not wired to checkout.
 */
import { MAX_CART_ITEMS, MAX_CHECKOUT_SUBTOTAL_MINOR } from './checkout.js';

export interface AllocationWeight {
  /** Stable canonical, non-sensitive group ID, not a customer-supplied label. */
  readonly groupId: string;
  readonly weight: bigint;
}
export interface AllocatedAmount extends AllocationWeight {
  readonly amountMinor: bigint;
}
export interface AllocationCalculation {
  readonly kind: 'ARITHMETIC_ONLY';
  readonly totalMinor: bigint;
  readonly groups: readonly AllocatedAmount[];
}

/**
 * Allocate explicitly supplied minor units in proportion to explicit integer
 * weights, by the largest-remainder method. Ties use canonical group IDs in
 * ascending ASCII order, independent of input order. No policy or source data
 * is inferred; a caller must separately approve this method and weights.
 */
export function allocateCheckoutAmount(totalMinor: bigint, weights: readonly AllocationWeight[]): AllocationCalculation {
  if (typeof totalMinor !== 'bigint' || totalMinor < 0n || totalMinor > MAX_CHECKOUT_SUBTOTAL_MINOR) throw new Error('ALLOCATION_TOTAL_INVALID');
  if (!Array.isArray(weights) || weights.length === 0 || weights.length > MAX_CART_ITEMS) throw new Error('ALLOCATION_GROUP_COUNT_INVALID');
  const seen = new Set<string>();
  let sum = 0n;
  for (const entry of weights) {
    if (!entry || typeof entry !== 'object' || typeof entry.groupId !== 'string' || !/^[a-z0-9_-]{1,128}$/.test(entry.groupId)) throw new Error('ALLOCATION_GROUP_INVALID');
    if (seen.has(entry.groupId)) throw new Error('ALLOCATION_GROUP_DUPLICATE');
    seen.add(entry.groupId);
    if (typeof entry.weight !== 'bigint' || entry.weight < 0n || entry.weight > MAX_CHECKOUT_SUBTOTAL_MINOR) throw new Error('ALLOCATION_WEIGHT_INVALID');
    sum += entry.weight; // BigInt: the sum need not fit in a DB monetary column.
  }
  if (sum === 0n) throw new Error('ALLOCATION_ZERO_WEIGHT');

  const rows = weights.map(({ groupId, weight }) => {
    const numerator = totalMinor * weight;
    return { groupId, weight, amountMinor: numerator / sum, remainder: numerator % sum };
  });
  const floorTotal = rows.reduce((acc, row) => acc + row.amountMinor, 0n);
  const remaining = totalMinor - floorTotal;
  // The sum of fractional remainders is always less than the number of groups.
  if (remaining < 0n || remaining >= BigInt(rows.length)) throw new Error('ALLOCATION_INTERNAL_ERROR');
  const ranked = [...rows].sort((a, b) => a.remainder === b.remainder ? (a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0) : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; i < Number(remaining); i++) ranked[i]!.amountMinor += 1n;
  rows.sort((a, b) => a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0);
  return { kind: 'ARITHMETIC_ONLY', totalMinor, groups: rows.map(({ groupId, weight, amountMinor }) => ({ groupId, weight, amountMinor })) };
}
