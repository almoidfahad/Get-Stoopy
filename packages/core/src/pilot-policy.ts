/**
 * Owner-approved Bangladesh pilot policy.
 *
 * Provenance matters here: every number below was approved by the owner for
 * DEVELOPMENT use only (docs/56, decision recorded 2026-11-04). None of it
 * authorizes live money movement. The policy is versioned and frozen so that a
 * later change cannot retroactively reinterpret an existing order, assignment or
 * settlement: callers snapshot `policyVersion` alongside the amounts they derive.
 *
 * Deliberately NOT decided here:
 *   - customer delivery fee (separate commercial decision; never derived from rider pay)
 *   - provider contracts, real disbursement, production region
 *   - legal retention obligations, which need qualified review before real KYC data
 */

export const PILOT_POLICY_VERSION = 'bd-pilot-2026-11-04.1';

export interface RiderRateSlabPolicy {
  /** inclusive lower bound in metres */
  readonly lowerMeters: number;
  /** exclusive upper bound in metres; null means unbounded */
  readonly upperMeters: number | null;
  /** rider pay for the slab, in minor units (poisha) */
  readonly amountMinor: bigint;
}

export interface PilotPolicy {
  readonly policyVersion: string;
  readonly countryCode: 'BD';
  readonly currencyCode: 'BDT';
  readonly timeZone: string;
  /** development only: nothing in this policy may drive a live transfer */
  readonly scope: 'development';
  readonly activationState: 'draft';
  readonly commission: {
    readonly bps: number;
    readonly includesDelivery: false;
    readonly earnedOn: 'delivery_completion';
  };
  readonly settlement: {
    readonly holdDays: number;
    readonly requiresVerifiedCodDeposit: true;
  };
  readonly payout: {
    /** 0 = Sunday */
    readonly weekday: number;
    readonly processingHour: number;
    /** cutoff weekday, 6 = Saturday, at end of that local day */
    readonly cutoffWeekday: number;
    /** ISO dates (YYYY-MM-DD) in the operational timezone; owner-verified annually */
    readonly holidays: readonly string[];
    /** Bangladesh weekend: Friday and Saturday */
    readonly weekendWeekdays: readonly number[];
  };
  readonly cod: { readonly automaticOffsetEnabled: false };
  readonly kycRetention: {
    readonly approvedDays: number;
    readonly rejectedDays: number;
    readonly auditMetadataYears: number;
    readonly legalBasis: 'owner-approved-development-default-pending-legal-review';
  };
  readonly riderRateSlabs: readonly RiderRateSlabPolicy[];
  /** additional pay per started kilometre beyond the final bounded slab */
  readonly riderOverflowPerKmMinor: bigint;
  readonly pilot: {
    readonly city: string;
    readonly zoneLabels: readonly string[];
    readonly geometryState: 'pending-owner-reviewed-geojson';
  };
}

// `as const` keeps the literal types (`false`, `'development'`, `'draft'`) that the
// interface pins down; `Object.freeze` alone would widen them to boolean/string.
const BD_PILOT_POLICY_VALUE = {
  policyVersion: PILOT_POLICY_VERSION,
  countryCode: 'BD',
  currencyCode: 'BDT',
  timeZone: 'Asia/Dhaka',
  scope: 'development',
  activationState: 'draft',
  commission: { bps: 1000, includesDelivery: false, earnedOn: 'delivery_completion' },
  settlement: { holdDays: 7, requiresVerifiedCodDeposit: true },
  payout: {
    weekday: 0,
    processingHour: 10,
    cutoffWeekday: 6,
    // Empty by design. A holiday list is only trustworthy once the owner verifies
    // it against an authoritative Bangladesh government source for the year.
    holidays: Object.freeze([]),
    weekendWeekdays: Object.freeze([5, 6]),
  },
  cod: { automaticOffsetEnabled: false },
  kycRetention: {
    approvedDays: 365,
    rejectedDays: 90,
    auditMetadataYears: 7,
    legalBasis: 'owner-approved-development-default-pending-legal-review',
  },
  riderRateSlabs: Object.freeze([
    Object.freeze({ lowerMeters: 0, upperMeters: 2000, amountMinor: 4000n }),
    Object.freeze({ lowerMeters: 2000, upperMeters: 4000, amountMinor: 6000n }),
    Object.freeze({ lowerMeters: 4000, upperMeters: 6000, amountMinor: 8000n }),
    Object.freeze({ lowerMeters: 6000, upperMeters: 10000, amountMinor: 11000n }),
    Object.freeze({ lowerMeters: 10000, upperMeters: null, amountMinor: 11000n }),
  ]),
  riderOverflowPerKmMinor: 1200n,
  pilot: {
    city: 'Dhaka',
    zoneLabels: Object.freeze(['Uttara Sector 1-4', 'Uttara Sector 5-9']),
    geometryState: 'pending-owner-reviewed-geojson',
  },
} as const satisfies PilotPolicy;

export const BD_PILOT_POLICY: PilotPolicy = Object.freeze(BD_PILOT_POLICY_VALUE);

/**
 * Rider pay for a distance under this policy.
 *
 * Slabs are contiguous and half-open: a distance exactly on a boundary belongs to
 * the higher slab, so there is no gap and no double count. Beyond the last bounded
 * slab, each *started* kilometre adds the overflow amount.
 */
export function pilotRiderPayMinor(distanceMeters: number, policy: PilotPolicy = BD_PILOT_POLICY): bigint {
  if (!Number.isInteger(distanceMeters) || distanceMeters < 0 || distanceMeters > 500_000) {
    throw new Error('PILOT_DISTANCE_INVALID');
  }
  const slabs = policy.riderRateSlabs;
  const last = slabs[slabs.length - 1];
  if (!last) throw new Error('PILOT_SLABS_EMPTY');
  for (const slab of slabs) {
    if (slab.upperMeters === null) continue;
    if (distanceMeters >= slab.lowerMeters && distanceMeters < slab.upperMeters) return slab.amountMinor;
  }
  const threshold = last.lowerMeters;
  if (distanceMeters < threshold) throw new Error('PILOT_SLAB_GAP');
  const extraKm = Math.ceil((distanceMeters - threshold) / 1000);
  return last.amountMinor + BigInt(extraKm) * policy.riderOverflowPerKmMinor;
}

/**
 * Guards the invariants the owner approved. Called in tests and by any loader that
 * accepts a policy from configuration, so a malformed override fails loudly rather
 * than silently paying the wrong amount.
 */
export function assertPilotPolicy(policy: PilotPolicy): void {
  if (policy.scope !== 'development') throw new Error('PILOT_POLICY_SCOPE_NOT_DEVELOPMENT');
  if (policy.activationState !== 'draft') throw new Error('PILOT_POLICY_NOT_DRAFT');
  if (policy.cod.automaticOffsetEnabled !== false) throw new Error('PILOT_COD_OFFSET_NOT_AUTHORIZED');
  if (policy.commission.includesDelivery !== false) throw new Error('PILOT_COMMISSION_MUST_EXCLUDE_DELIVERY');
  if (!Number.isInteger(policy.commission.bps) || policy.commission.bps < 0 || policy.commission.bps >= 10000) {
    throw new Error('PILOT_COMMISSION_BPS_INVALID');
  }
  if (!Number.isInteger(policy.settlement.holdDays) || policy.settlement.holdDays < 0 || policy.settlement.holdDays > 90) {
    throw new Error('PILOT_HOLD_DAYS_INVALID');
  }
  if (!Number.isInteger(policy.payout.weekday) || policy.payout.weekday < 0 || policy.payout.weekday > 6) {
    throw new Error('PILOT_PAYOUT_WEEKDAY_INVALID');
  }
  if (!Number.isInteger(policy.payout.processingHour) || policy.payout.processingHour < 0 || policy.payout.processingHour > 23) {
    throw new Error('PILOT_PAYOUT_HOUR_INVALID');
  }
  for (const holiday of policy.payout.holidays) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday)) throw new Error('PILOT_HOLIDAY_FORMAT_INVALID');
  }
  const slabs = policy.riderRateSlabs;
  if (slabs.length === 0) throw new Error('PILOT_SLABS_EMPTY');
  let expectedLower = 0;
  for (let i = 0; i < slabs.length; i += 1) {
    const slab = slabs[i];
    if (!slab) throw new Error('PILOT_SLAB_MISSING');
    if (slab.lowerMeters !== expectedLower) throw new Error('PILOT_SLAB_GAP');
    if (slab.amountMinor <= 0n) throw new Error('PILOT_SLAB_AMOUNT_INVALID');
    const isLast = i === slabs.length - 1;
    if (isLast) {
      if (slab.upperMeters !== null) throw new Error('PILOT_SLAB_LAST_MUST_BE_UNBOUNDED');
    } else {
      if (slab.upperMeters === null || slab.upperMeters <= slab.lowerMeters) throw new Error('PILOT_SLAB_BOUNDS_INVALID');
      expectedLower = slab.upperMeters;
    }
  }
}