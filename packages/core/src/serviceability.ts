export interface OperatingHourInput { dayOfWeek: number; openMinute: number; closeMinute: number; }
export const MAX_OPERATING_HOUR_ROWS = 21;
export const LOCATION_MAX_ACCURACY_METERS = 100;
export const LOCATION_FRESHNESS_SECONDS = 120;
export const LOCATION_MAX_FUTURE_SKEW_SECONDS = 30;

export function assertLatitudeLongitude(latitude: number, longitude: number): void {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('LATITUDE_INVALID');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('LONGITUDE_INVALID');
}

export function assertOperatingHours(hours: OperatingHourInput[]): void {
  if (!Array.isArray(hours) || hours.length === 0 || hours.length > MAX_OPERATING_HOUR_ROWS) throw new Error('OPERATING_HOURS_INVALID');
  const byDay = new Map<number, OperatingHourInput[]>();
  for (const h of hours) {
    if (!Number.isInteger(h.dayOfWeek) || h.dayOfWeek < 0 || h.dayOfWeek > 6) throw new Error('OPERATING_DAY_INVALID');
    if (!Number.isInteger(h.openMinute) || h.openMinute < 0 || h.openMinute > 1439) throw new Error('OPERATING_OPEN_INVALID');
    if (!Number.isInteger(h.closeMinute) || h.closeMinute < 1 || h.closeMinute > 1440) throw new Error('OPERATING_CLOSE_INVALID');
    if (h.closeMinute <= h.openMinute) throw new Error('OPERATING_WINDOW_INVALID');
    const list = byDay.get(h.dayOfWeek) ?? [];
    list.push(h); byDay.set(h.dayOfWeek, list);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.openMinute - b.openMinute);
    for (let i = 1; i < list.length; i++) if (list[i]!.openMinute < list[i - 1]!.closeMinute) throw new Error('OPERATING_HOURS_OVERLAP');
  }
}

/** Local store time only; timezone conversion belongs to the caller/country configuration. */
export function isOpenAt(hours: OperatingHourInput[], dayOfWeek: number, minuteOfDay: number): boolean {
  return hours.some(h => h.dayOfWeek === dayOfWeek && minuteOfDay >= h.openMinute && minuteOfDay < h.closeMinute);
}

export interface StoreServiceabilityRecord {
  storeStatus: string;
  vendorEligible: boolean;
  pickupStatus?: string | null;
  serviceAreaStatuses: string[];
  operatingHourCount: number;
}

export function isStoreDispatchServiceable(record: StoreServiceabilityRecord): boolean {
  return record.storeStatus === 'ACTIVE'
    && record.vendorEligible
    && record.pickupStatus === 'APPROVED'
    && record.operatingHourCount > 0
    && record.serviceAreaStatuses.includes('APPROVED');
}
