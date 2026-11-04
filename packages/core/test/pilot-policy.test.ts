import { describe, expect, it } from 'vitest';
import {
  BD_PILOT_POLICY,
  PILOT_POLICY_VERSION,
  assertPilotPolicy,
  pilotRiderPayMinor,
  settlementHoldUntil,
  settlementLineAmounts,
} from '../src/index.js';

describe('owner-approved BD pilot policy', () => {
  it('matches the values the owner approved and stays development-only', () => {
    expect(BD_PILOT_POLICY.policyVersion).toBe(PILOT_POLICY_VERSION);
    expect(BD_PILOT_POLICY.scope).toBe('development');
    expect(BD_PILOT_POLICY.activationState).toBe('draft');
    expect(BD_PILOT_POLICY.commission.bps).toBe(1000);
    expect(BD_PILOT_POLICY.commission.includesDelivery).toBe(false);
    expect(BD_PILOT_POLICY.settlement.holdDays).toBe(7);
    expect(BD_PILOT_POLICY.cod.automaticOffsetEnabled).toBe(false);
    expect(BD_PILOT_POLICY.kycRetention.approvedDays).toBe(365);
    expect(BD_PILOT_POLICY.kycRetention.rejectedDays).toBe(90);
    expect(BD_PILOT_POLICY.kycRetention.auditMetadataYears).toBe(7);
    expect(() => assertPilotPolicy(BD_PILOT_POLICY)).not.toThrow();
  });

  it('ships no unverified holiday list', () => {
    // A holiday calendar is only trustworthy once owner-verified against an
    // authoritative source; an invented list would silently defer real payouts.
    expect(BD_PILOT_POLICY.payout.holidays).toEqual([]);
  });

  it('is frozen so a caller cannot mutate approved amounts at runtime', () => {
    expect(Object.isFrozen(BD_PILOT_POLICY)).toBe(true);
    expect(Object.isFrozen(BD_PILOT_POLICY.riderRateSlabs)).toBe(true);
  });

  it('rejects an override that would enable live scope, COD offset or delivery-inclusive commission', () => {
    expect(() => assertPilotPolicy({ ...BD_PILOT_POLICY, scope: 'production' as 'development' })).toThrow(
      'PILOT_POLICY_SCOPE_NOT_DEVELOPMENT',
    );
    expect(() =>
      assertPilotPolicy({ ...BD_PILOT_POLICY, cod: { automaticOffsetEnabled: true as false } }),
    ).toThrow('PILOT_COD_OFFSET_NOT_AUTHORIZED');
    expect(() =>
      assertPilotPolicy({
        ...BD_PILOT_POLICY,
        commission: { ...BD_PILOT_POLICY.commission, includesDelivery: true as false },
      }),
    ).toThrow('PILOT_COMMISSION_MUST_EXCLUDE_DELIVERY');
    expect(() =>
      assertPilotPolicy({ ...BD_PILOT_POLICY, settlement: { ...BD_PILOT_POLICY.settlement, holdDays: 400 } }),
    ).toThrow('PILOT_HOLD_DAYS_INVALID');
  });

  it('rejects a malformed holiday entry or a slab gap', () => {
    expect(() =>
      assertPilotPolicy({
        ...BD_PILOT_POLICY,
        payout: { ...BD_PILOT_POLICY.payout, holidays: ['2026-12-16', '16/12/2026'] },
      }),
    ).toThrow('PILOT_HOLIDAY_FORMAT_INVALID');
    expect(() =>
      assertPilotPolicy({
        ...BD_PILOT_POLICY,
        riderRateSlabs: [
          { lowerMeters: 0, upperMeters: 2000, amountMinor: 4000n },
          { lowerMeters: 2500, upperMeters: null, amountMinor: 6000n },
        ],
      }),
    ).toThrow('PILOT_SLAB_GAP');
  });
});

describe('pilot rider pay', () => {
  it('applies the approved slabs, with boundaries belonging to the higher slab', () => {
    expect(pilotRiderPayMinor(0)).toBe(4000n);
    expect(pilotRiderPayMinor(1999)).toBe(4000n);
    expect(pilotRiderPayMinor(2000)).toBe(6000n);
    expect(pilotRiderPayMinor(3999)).toBe(6000n);
    expect(pilotRiderPayMinor(4000)).toBe(8000n);
    expect(pilotRiderPayMinor(6000)).toBe(11000n);
    expect(pilotRiderPayMinor(9999)).toBe(11000n);
    expect(pilotRiderPayMinor(10000)).toBe(11000n);
  });

  it('charges each started kilometre beyond the last bounded slab', () => {
    expect(pilotRiderPayMinor(10001)).toBe(12200n);
    expect(pilotRiderPayMinor(11000)).toBe(12200n);
    expect(pilotRiderPayMinor(11001)).toBe(13400n);
    expect(pilotRiderPayMinor(15000)).toBe(17000n);
  });

  it('never decreases as distance grows', () => {
    let previous = 0n;
    for (let m = 0; m <= 20000; m += 137) {
      const pay = pilotRiderPayMinor(m);
      expect(pay).toBeGreaterThanOrEqual(previous);
      previous = pay;
    }
  });

  it('rejects invalid distances instead of guessing', () => {
    expect(() => pilotRiderPayMinor(-1)).toThrow('PILOT_DISTANCE_INVALID');
    expect(() => pilotRiderPayMinor(12.5)).toThrow('PILOT_DISTANCE_INVALID');
    expect(() => pilotRiderPayMinor(500_001)).toThrow('PILOT_DISTANCE_INVALID');
  });
});

describe('approved policy composes with existing settlement math', () => {
  it('reproduces the documented BDT 1000 example at 10% excluding delivery', () => {
    const amounts = settlementLineAmounts({ grossMinor: 100_000n, commissionBps: BD_PILOT_POLICY.commission.bps });
    expect(amounts.commissionMinor).toBe(10_000n);
    expect(amounts.netMinor).toBe(90_000n);
  });

  it('holds settlement for exactly the approved 7 days after completion', () => {
    const completedAt = new Date('2026-11-04T06:00:00.000Z');
    const holdUntil = settlementHoldUntil(completedAt, BD_PILOT_POLICY.settlement.holdDays);
    expect(holdUntil.toISOString()).toBe('2026-11-11T06:00:00.000Z');
  });
});