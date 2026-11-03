import { describe, expect, it } from 'vitest';
import { settlementHoldUntil, settlementLineAmounts, settlementTotals } from '../src/index.js';
describe('vendor settlement calculation policy', () => {
  it('uses integer minor units and explicit per-line floor rounding', () => {
    expect(settlementLineAmounts({ grossMinor: 1001n, commissionBps: 1000 })).toEqual({ grossMinor: 1001n, commissionMinor: 100n, netMinor: 901n });
    expect(settlementLineAmounts({ grossMinor: 1n, commissionBps: 9999 })).toEqual({ grossMinor: 1n, commissionMinor: 0n, netMinor: 1n });
    expect(settlementTotals([{ grossMinor: 1001n, commissionBps: 1000 }, { grossMinor: 999n, commissionBps: 1000 }])).toEqual({ grossMinor: 2000n, commissionMinor: 199n, netMinor: 1801n });
  });
  it('rejects missing items, invalid rates, zero gross and non-positive net', () => {
    expect(() => settlementTotals([])).toThrow('SETTLEMENT_ITEMS_INVALID');
    expect(() => settlementLineAmounts({ grossMinor: 0n, commissionBps: 1000 })).toThrow('SETTLEMENT_GROSS_INVALID');
    expect(() => settlementLineAmounts({ grossMinor: 100n, commissionBps: 10000 })).toThrow('SETTLEMENT_BPS_INVALID');
    expect(() => settlementLineAmounts({ grossMinor: 100n, commissionBps: -1 })).toThrow('SETTLEMENT_BPS_INVALID');
  });
  it('applies the exact configured hold without inventing a weekday schedule', () => {
    const now = new Date('2026-11-03T00:00:00Z'); expect(settlementHoldUntil(now, 0)).toEqual(now);
    expect(settlementHoldUntil(now, 7).toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(() => settlementHoldUntil(now, 91)).toThrow('SETTLEMENT_HOLD_INVALID');
  });
});
