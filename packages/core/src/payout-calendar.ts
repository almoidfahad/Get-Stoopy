/**
 * Payout scheduling in the operational timezone, with holiday deferral.
 *
 * Policy (owner-approved for development, docs/56): weekly Sunday 10:00 Asia/Dhaka,
 * earning cutoff the preceding Saturday at end of local day, and a payout that
 * lands on a holiday or weekend moves to the next business day. "Instant payout"
 * is never claimed; the returned reason records why a run moved.
 *
 * Two rules that are easy to get wrong and are asserted in tests:
 *
 *  1. Deferring the *processing* day must NOT move the *earning cutoff*. The cutoff
 *     belongs to the original period, otherwise a holiday would silently change
 *     which earnings a rider is paid for.
 *  2. All arithmetic happens on local calendar dates, then converts to a UTC
 *     instant. Adding 7*24h to a UTC timestamp is not the same thing in a zone that
 *     changes offset, so it is never done here.
 *
 * Timezone conversion uses the platform IANA database via Intl rather than a
 * hardcoded +06:00, so a future rule change in the zone does not silently break it.
 */
import type { PilotPolicy } from './pilot-policy.js';
import { BD_PILOT_POLICY } from './pilot-policy.js';

export interface LocalDate {
  readonly year: number;
  /** 1-12 */
  readonly month: number;
  /** 1-31 */
  readonly day: number;
}

export type PayoutDeferralReason = 'scheduled' | 'holiday' | 'weekend' | 'holiday_and_weekend';

export interface PayoutRun {
  /** when the run is actually attempted */
  readonly scheduledAtUtc: Date;
  /** earnings earned at or before this instant belong to this run */
  readonly cutoffUtc: Date;
  /** the originally scheduled local date, before any deferral */
  readonly periodDate: LocalDate;
  /** the local date the run actually happens on */
  readonly processingDate: LocalDate;
  readonly reason: PayoutDeferralReason;
  readonly deferredDays: number;
  readonly policyVersion: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface WallParts extends LocalDate {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function wallParts(instant: Date, timeZone: string): WallParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find(p => p.type === type);
    if (!found) throw new Error('PAYOUT_TZ_PART_MISSING');
    return Number(found.value);
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

export function localDateOf(instant: Date, timeZone: string): LocalDate {
  if (!Number.isFinite(instant.getTime())) throw new Error('PAYOUT_INSTANT_INVALID');
  const { year, month, day } = wallParts(instant, timeZone);
  return { year, month, day };
}

/** 0 = Sunday … 6 = Saturday, for a local calendar date. */
export function weekdayOf(date: LocalDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function isoDate(date: LocalDate): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(date.year).padStart(4, '0')}-${pad(date.month)}-${pad(date.day)}`;
}

export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** Convert a local wall-clock time to the UTC instant it denotes. */
export function wallTimeToUtc(
  date: LocalDate,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  timeZone: string,
): Date {
  const target = Date.UTC(date.year, date.month - 1, date.day, hour, minute, second, millisecond);
  let ts = target;
  for (let i = 0; i < 4; i += 1) {
    const local = wallParts(new Date(ts), timeZone);
    const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, ts % 1000 < 0 ? 0 : ((ts % 1000) + 1000) % 1000);
    const offset = localAsUtc - ts;
    const next = target - offset;
    if (next === ts) return new Date(ts);
    ts = next;
  }
  return new Date(ts);
}

function isWeekend(date: LocalDate, policy: PilotPolicy): boolean {
  return policy.payout.weekendWeekdays.includes(weekdayOf(date));
}

function isHoliday(date: LocalDate, policy: PilotPolicy): boolean {
  return policy.payout.holidays.includes(isoDate(date));
}

export function isBusinessDay(date: LocalDate, policy: PilotPolicy = BD_PILOT_POLICY): boolean {
  return !isWeekend(date, policy) && !isHoliday(date, policy);
}

/**
 * The next payout run strictly after `asOf`.
 *
 * The cutoff is anchored to the original period date even when processing is
 * deferred, so a holiday never changes which earnings are included.
 */
export function nextPayoutRun(asOf: Date, policy: PilotPolicy = BD_PILOT_POLICY): PayoutRun {
  if (!Number.isFinite(asOf.getTime())) throw new Error('PAYOUT_INSTANT_INVALID');
  const tz = policy.timeZone;
  const hour = policy.payout.processingHour;

  let candidate = localDateOf(asOf, tz);
  let found = false;
  for (let i = 0; i < 8; i += 1) {
    if (weekdayOf(candidate) === policy.payout.weekday) {
      const instant = wallTimeToUtc(candidate, hour, 0, 0, 0, tz);
      if (instant.getTime() > asOf.getTime()) {
        found = true;
        break;
      }
    }
    candidate = addLocalDays(candidate, 1);
  }
  if (!found) throw new Error('PAYOUT_PERIOD_NOT_FOUND');

  const periodDate = candidate;
  let processingDate = candidate;
  let sawHoliday = false;
  let sawWeekend = false;
  for (let i = 0; i < 62; i += 1) {
    const holiday = isHoliday(processingDate, policy);
    const weekend = isWeekend(processingDate, policy);
    if (!holiday && !weekend) break;
    sawHoliday = sawHoliday || holiday;
    sawWeekend = sawWeekend || weekend;
    processingDate = addLocalDays(processingDate, 1);
    if (i === 61) throw new Error('PAYOUT_DEFERRAL_UNBOUNDED');
  }

  let reason: PayoutDeferralReason = 'scheduled';
  if (sawHoliday && sawWeekend) reason = 'holiday_and_weekend';
  else if (sawHoliday) reason = 'holiday';
  else if (sawWeekend) reason = 'weekend';

  const back = ((policy.payout.weekday - policy.payout.cutoffWeekday + 7) % 7) || 7;
  const cutoffDate = addLocalDays(periodDate, -back);
  if (weekdayOf(cutoffDate) !== policy.payout.cutoffWeekday) throw new Error('PAYOUT_CUTOFF_WEEKDAY_MISMATCH');

  const deferredDays = Math.round(
    (Date.UTC(processingDate.year, processingDate.month - 1, processingDate.day) -
      Date.UTC(periodDate.year, periodDate.month - 1, periodDate.day)) /
      86_400_000,
  );

  return {
    scheduledAtUtc: wallTimeToUtc(processingDate, hour, 0, 0, 0, tz),
    cutoffUtc: wallTimeToUtc(cutoffDate, 23, 59, 59, 999, tz),
    periodDate,
    processingDate,
    reason,
    deferredDays,
    policyVersion: policy.policyVersion,
  };
}