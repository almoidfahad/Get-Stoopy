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

export async function fetchServiceableCities(): Promise<CitiesResult> {
  const countryId = marketCountryId();
  if (!countryId) return { state: 'not-configured' };
  try {
    const res = await apiFetch(`/public/serviceability/cities?countryId=${encodeURIComponent(countryId)}`);
    if (!res.ok) return { state: 'unavailable' };
    return { state: 'ok', data: (await res.json()) as ServiceableCities };
  } catch {
    return { state: 'unavailable' };
  }
}
