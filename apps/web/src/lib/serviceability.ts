import { apiFetch } from './bff';
import { marketCountryId } from './catalog';

/**
 * Server-side reads of the public serviceable-city lookup.
 *
 * The list comes from the API rather than a hardcoded list of Bangladeshi cities:
 * a city is only offered when a store in the cart's market actually has approved
 * coverage there. Offering a city the backend will reject would waste the buyer's
 * time and reserve nothing.
 */

export interface ServiceableCity {
  cityId: string;
  name: string;
  code: string;
  storeCount: number;
}

export interface ServiceableCities {
  countryId: string;
  currency: string;
  items: ServiceableCity[];
  truncated: boolean;
}

export type CitiesResult =
  | { state: 'ok'; data: ServiceableCities }
  | { state: 'not-configured' }
  | { state: 'unavailable' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate the public list without assuming it guarantees this cart's coverage. */
function isServiceableCities(value: unknown, countryId: string): value is ServiceableCities {
  if (!value || typeof value !== 'object') return false;
  const list = value as Record<string, unknown>;
  if (typeof list.countryId !== 'string' || !UUID_RE.test(list.countryId) || list.countryId.toLowerCase() !== countryId.toLowerCase() ||
      typeof list.currency !== 'string' || !list.currency.trim() || typeof list.truncated !== 'boolean' || !Array.isArray(list.items)) return false;
  const seen = new Set<string>();
  for (const raw of list.items) {
    if (!raw || typeof raw !== 'object') return false;
    const city = raw as Record<string, unknown>;
    if (typeof city.cityId !== 'string' || !UUID_RE.test(city.cityId) ||
        typeof city.name !== 'string' || !city.name.trim() || typeof city.code !== 'string' || !city.code.trim() ||
        typeof city.storeCount !== 'number' || !Number.isSafeInteger(city.storeCount) || city.storeCount < 1) return false;
    const id = city.cityId.toLowerCase();
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

export async function fetchServiceableCities(): Promise<CitiesResult> {
  const countryId = marketCountryId();
  if (!countryId) return { state: 'not-configured' };
  try {
    const res = await apiFetch(`/public/serviceability/cities?countryId=${encodeURIComponent(countryId)}`, { redirect: 'manual', signal: AbortSignal.timeout(8_000) });
    if (res.status !== 200) return { state: 'unavailable' };
    const data: unknown = await res.json();
    if (!isServiceableCities(data, countryId)) return { state: 'unavailable' };
    // UUIDs can arrive in either case. Canonicalize them for selection and
    // comparison against recovered quote destinations.
    return { state: 'ok', data: { ...data, countryId: data.countryId.toLowerCase(), items: data.items.map(city => ({ ...city, cityId: city.cityId.toLowerCase() })) } };
  } catch {
    return { state: 'unavailable' };
  }
}
