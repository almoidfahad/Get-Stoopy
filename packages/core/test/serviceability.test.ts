import { describe, expect, it } from 'vitest';
import { assertLatitudeLongitude, assertOperatingHours, isOpenAt, isStoreDispatchServiceable } from '../src/index.js';

describe('store serviceability helpers', () => {
  it('validates coordinates and operating windows', () => {
    expect(() => assertLatitudeLongitude(23.7, 90.4)).not.toThrow();
    expect(() => assertLatitudeLongitude(91, 90.4)).toThrow('LATITUDE_INVALID');
    expect(() => assertLatitudeLongitude(23.7, 181)).toThrow('LONGITUDE_INVALID');
    expect(() => assertOperatingHours([{ dayOfWeek: 0, openMinute: 540, closeMinute: 1020 }])).not.toThrow();
    expect(() => assertOperatingHours([])).toThrow('OPERATING_HOURS_INVALID');
    expect(() => assertOperatingHours([{ dayOfWeek: 0, openMinute: 540, closeMinute: 540 }])).toThrow('OPERATING_WINDOW_INVALID');
    expect(() => assertOperatingHours([{ dayOfWeek: 0, openMinute: 540, closeMinute: 1020 }, { dayOfWeek: 0, openMinute: 1000, closeMinute: 1200 }])).toThrow('OPERATING_HOURS_OVERLAP');
  });
  it.each([null, undefined, false, 5, 'bad', []])('rejects malformed operating window %s with a stable domain error', value => {
    expect(() => assertOperatingHours([value] as any)).toThrow('OPERATING_HOURS_INVALID');
  });
  it.each([
    [{ openMinute: 1, closeMinute: 2 }, 'OPERATING_DAY_INVALID'],
    [{ dayOfWeek: 0, openMinute: '540', closeMinute: 600 }, 'OPERATING_OPEN_INVALID'],
    [{ dayOfWeek: 0, openMinute: 540, closeMinute: null }, 'OPERATING_CLOSE_INVALID'],
  ])('rejects incomplete or nonnumeric fields', (window, code) => {
    expect(() => assertOperatingHours([window] as any)).toThrow(code as string);
  });
  it('uses lower-inclusive upper-exclusive local windows', () => {
    const hours = [{ dayOfWeek: 1, openMinute: 540, closeMinute: 1020 }];
    expect(isOpenAt(hours, 1, 540)).toBe(true);
    expect(isOpenAt(hours, 1, 1019)).toBe(true);
    expect(isOpenAt(hours, 1, 1020)).toBe(false);
    expect(isOpenAt(hours, 0, 600)).toBe(false);
  });
  it('fails closed unless pickup, hours and an approved service area exist', () => {
    const base = { storeStatus: 'ACTIVE', vendorEligible: true, pickupStatus: 'APPROVED', serviceAreaStatuses: ['APPROVED'], operatingHourCount: 1 };
    expect(isStoreDispatchServiceable(base)).toBe(true);
    expect(isStoreDispatchServiceable({ ...base, pickupStatus: 'DRAFT' })).toBe(false);
    expect(isStoreDispatchServiceable({ ...base, operatingHourCount: 0 })).toBe(false);
    expect(isStoreDispatchServiceable({ ...base, serviceAreaStatuses: ['DRAFT'] })).toBe(false);
    expect(isStoreDispatchServiceable({ ...base, vendorEligible: false })).toBe(false);
  });
});
