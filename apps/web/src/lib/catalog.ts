// Server-only by construction: this module reads cookies through ./bff, which
// imports next/headers and cannot be bundled into a client component.
import { buildShopQuery, type PublicVariant } from '@getstoopy/core';
import { apiFetch } from './bff';
import { isProductPage, isPublicCategories, isPublicProduct } from './catalog-validation';

/**
 * Server-side reads of the public catalog API.
 *
 * The browser never talks to the API directly and never receives an internal URL.
 * Everything degrades to an explicit state instead of throwing: an unreachable API
 * must render "catalog unavailable", not a stack trace or an invented product.
 */

export interface PublicCategory {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
}

export interface PublicProduct {
  id: string;
  title: string;
  description: string | null;
  brand: string | null;
  currency: string;
  category: { id: string; name: string; slug: string } | null;
  store?: { id: string; name: string; slug: string; cityId: string };
  variants: PublicVariant[];
  images: { id: string; altText: string | null; sortOrder: number; contentType: string; url: string }[];
  publishedAt: string | null;
}

export type CatalogResult<T> =
  | { state: 'ok'; data: T }
  | { state: 'not-configured' }
  | { state: 'not-found' }
  | { state: 'unavailable' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The market a deployment serves. Deliberately explicit: without a configured
 * country there is no honest catalog to show, so the UI says so rather than
 * guessing a country or seeding demo products.
 */
export function marketCountryId(): string | null {
  const value = process.env['MARKET_COUNTRY_ID'];
  return value && UUID_RE.test(value) ? value : null;
}

async function readJson<T>(path: string, validate: (value: unknown) => value is T): Promise<CatalogResult<T>> {
  try {
    // The deadline also covers body consumption; never follow an upstream
    // redirect and mistake its destination for the requested catalog resource.
    const res = await apiFetch(path, { redirect: 'manual', signal: AbortSignal.timeout(8_000) });
    if (res.status === 404) return { state: 'not-found' };
    if (res.status !== 200) return { state: 'unavailable' };
    const data: unknown = await res.json();
    return validate(data) ? { state: 'ok', data } : { state: 'unavailable' };
  } catch {
    return { state: 'unavailable' };
  }
}

export interface ProductPage {
  items: PublicProduct[];
  nextCursor: string | null;
}

export async function fetchProducts(input: {
  q?: string | undefined;
  categoryId?: string | undefined;
  cursor?: string | undefined;
}): Promise<CatalogResult<ProductPage>> {
  const countryId = marketCountryId();
  if (!countryId) return { state: 'not-configured' };
  const params = buildShopQuery(input);
  params.set('countryId', countryId);
  return readJson(`/public/catalog/products?${params.toString()}`, isProductPage);
}

export async function fetchCategories(): Promise<CatalogResult<PublicCategory[]>> {
  const countryId = marketCountryId();
  if (!countryId) return { state: 'not-configured' };
  return readJson(`/public/catalog/categories?countryId=${countryId}`, isPublicCategories);
}

export async function fetchProduct(id: string): Promise<CatalogResult<PublicProduct>> {
  const countryId = marketCountryId();
  if (!countryId) return { state: 'not-configured' };
  if (!UUID_RE.test(id)) return { state: 'not-found' };
  return readJson(`/public/catalog/products/${id}?countryId=${countryId}`, (value): value is PublicProduct =>
    isPublicProduct(value) && value.id.toLowerCase() === id.toLowerCase());
}

export { imageProxyUrl } from './catalog-image';