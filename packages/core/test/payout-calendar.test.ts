import { describe, expect, it } from 'vitest';
import {
  BD_PILOT_POLICY,
  addLocalDays,
  isBusinessDay,
  isoDate,
  localDateOf,
  nextPayoutRun,
  wallTimeToUtc,
  weekdayOf,
  type PilotPolicy,
} from '../src/index.js';

const withHolidays = (holidays: readonly string[]): PilotPolicy => ({
  ...BD_PILOT_POLICY,
  payout: { ...BD_PILOT_POLICY.payout, holidays },
});

describe('timezone-correct local calendar maths', () => {
  it('reads the Dhaka local date across the UTC boundary', () => {
    // 20:00 UTC on the 4th is already 02:00 on the 5th in Dhaka.
    expect(localDateOf(new Date('2026-11-04T20:00:00.000Z'), 'Asia/Dhaka')).toEqual({
      year: 2026,
      month: 11,
      day: 5,
    });
    expect(localDateOf(new Date('2026-11-04T06:00:00.000Z'), 'Asia/Dhaka')).toEqual({
      year: 2026,
      month: 11,
      day: 4,
    });
  });

  it('converts a Dhaka wall time to the right UTC instant', () => {
    const utc = wallTimeToUtc({ year: 2026, month: 11, day: 8 }, 10, 0, 0, 0, 'Asia/Dhaka');
    expect(utc.toISOString()).toBe('2026-11-08T04:00:00.000Z');
  });

  it('handles month and year rollover on local dates', () => {
    expect(isoDate(addLocalDays({ year: 2026, month: 12, day: 31 }, 1))).toBe('2027-01-01');
    expect(isoDate(addLocalDays({ year: 2028, month: 2, day: 28 }, 1))).toBe('2028-02-29');
    expect(weekdayOf({ year: 2026, month: 11, day: 8 })).toBe(0);
  });

  it('treats Friday and Saturday as the Bangladesh weekend', () => {
    expect(isBusinessDay({ year: 2026, month: 11, day: 6 })).toBe(false); // Friday
    expect(isBusinessDay({ year: 2026, month: 11, day: 7 })).toBe(false); // Saturday
    expect(isBusinessDay({ year: 2026, month: 11, day: 8 })).toBe(true); // Sunday
  });
});

describe('weekly payout run', () => {
  it('schedules Sunday 10:00 Dhaka with a Saturday end-of-day cutoff', () => {
    const run = nextPayoutRun(new Date('2026-11-04T06:00:00.000Z'));
    expect(run.scheduledAtUtc.toISOString()).toBe('2026-11-08T04:00:00.000Z');
    expect(run.cutoffUtc.toISOString()).toBe('2026-11-07T17:59:59.999Z');
    expect(isoDate(run.periodDate)).toBe('2026-11-08');
    expect(isoDate(run.processingDate)).toBe('2026-11-08');
    expect(run.reason).toBe('scheduled');
    expect(run.deferredDays).toBe(0);
    expect(run.policyVersion).toBe(BD_PILOT_POLICY.policyVersion);
  });

  it('moves to the following week once the processing instant has passed', () => {
    // 04:00:00Z is exactly 10:00 Dhaka; strictly-after means the next Sunday.
    const run = nextPayoutRun(new Date('2026-11-08T04:00:00.000Z'));
    expect(run.scheduledAtUtc.toISOString()).toBe('2026-11-15T04:00:00.000Z');
    expect(run.cutoffUtc.toISOString()).toBe('2026-11-14T17:59:59.999Z');
  });

  it('still selects the same Sunday just before the processing instant', () => {
    const run = nextPayoutRun(new Date('2026-11-08T03:59:59.999Z'));
    expect(run.scheduledAtUtc.toISOString()).toBe('2026-11-08T04:00:00.000Z');
  });

  it('defers a holiday Sunday to Monday but keeps the original earning cutoff', () => {
    const policy = withHolidays(['2026-11-08']);
    const run = nextPayoutRun(new Date('2026-11-04T06:00:00.000Z'), policy);
    expect(isoDate(run.periodDate)).toBe('2026-11-08');
    expect(isoDate(run.processingDate)).toBe('2026-11-09');
    expect(run.scheduledAtUtc.toISOString()).toBe('2026-11-09T04:00:00.000Z');
    // The cutoff must NOT move with the deferral, or the paid earnings window changes.
    expect(run.cutoffUtc.toISOString()).toBe('2026-11-07T17:59:59.999Z');
    expect(run.reason).toBe('holiday');
    expect(run.deferredDays).toBe(1);
  });

  it('skips a run of consecutive holidays and reports the reason', () => {
    const policy = withHolidays(['2026-11-08', '2026-11-09', '2026-11-10']);
    const run = nextPayoutRun(new Date('2026-11-04T06:00:00.000Z'), policy);
    expect(isoDate(run.processingDate)).toBe('2026-11-11');
    expect(run.deferredDays).toBe(3);
    expect(run.reason).toBe('holiday');
    expect(run.cutoffUtc.toISOString()).toBe('2026-11-07T17:59:59.999Z');
  });

  it('reports a combined reason when deferral crosses both a holiday and a weekend', () => {
    const policy: PilotPolicy = {
      ...withHolidays(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']),
    };
    const run = nextPayoutRun(new Date('2026-11-04T06:00:00.000Z'), policy);
    // Fri 13 and Sat 14 are weekend, so the first business day is Sunday 15.
    expect(isoDate(run.processingDate)).toBe('2026-11-15');
    expect(run.reason).toBe('holiday_and_weekend');
    expect(run.deferredDays).toBe(7);
    expect(run.cutoffUtc.toISOString()).toBe('2026-11-07T17:59:59.999Z');
  });

  it('refuses to defer forever when every day is a holiday', () => {
    const everyDay: string[] = [];
    let date = { year: 2026, month: 11, day: 8 };
    for (let i = 0; i < 80; i += 1) {
      everyDay.push(isoDate(date));
      date = addLocalDays(date, 1);
    }
    expect(() => nextPayoutRun(new Date('2026-11-04T06:00:00.000Z'), withHolidays(everyDay))).toThrow(
      'PAYOUT_DEFERRAL_UNBOUNDED',
    );
  });

  it('produces a strictly increasing schedule across many weeks', () => {
    let cursor = new Date('2026-11-04T06:00:00.000Z');
    let previous = 0;
    for (let i = 0; i < 30; i += 1) {
      const run = nextPayoutRun(cursor);
      expect(run.scheduledAtUtc.getTime()).toBeGreaterThan(previous);
      expect(run.cutoffUtc.getTime()).toBeLessThan(run.scheduledAtUtc.getTime());
      previous = run.scheduledAtUtc.getTime();
      cursor = run.scheduledAtUtc;
    }
  });

  it('rejects an invalid instant rather than scheduling from NaN', () => {
    expect(() => nextPayoutRun(new Date('not-a-date'))).toThrow('PAYOUT_INSTANT_INVALID');
  });
});