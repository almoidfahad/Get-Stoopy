import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/bff', () => ({ apiFetch: mocks.apiFetch }));
import { fetchCategories, fetchProduct, fetchProducts } from '../src/lib/catalog';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const variantId = '33333333-3333-4333-8333-333333333333';
const imageId = '44444444-4444-4444-8444-444444444444';
const variant = { id: variantId, productId: id, priceAmountMinor: '1200', currency: 'BDT', availableToPromise: 3, inStock: true, optionValues: {}, compareAtAmountMinor: null };
const image = { id: imageId, altText: 'Side', sortOrder: 0, contentType: 'image/jpeg', url: '/ignored' };
const product = { id, title: 'Fixture', description: 'Description', brand: null, category: null, store: { id: other, name: 'Store', slug: 'store', cityId: other }, currency: 'BDT', variants: [variant], images: [image], publishedAt: '2025-01-01T00:00:00.000Z' };
const category = { id: other, parentId: null, name: 'Home', slug: 'home', description: null, sortOrder: 0 };
const respond = (body: unknown) => mocks.apiFetch.mockResolvedValue(Response.json(body));
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('MARKET_COUNTRY_ID', id); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('catalog response validation', () => {
  it('accepts backend-shaped list, detail, categories and empty responses', async () => {
    for (const [body, run] of [
      [{ items: [product], nextCursor: null }, () => fetchProducts({})],
      [product, () => fetchProduct(id)],
      [[category], () => fetchCategories()],
      [{ items: [], nextCursor: null }, () => fetchProducts({})],
      [[], () => fetchCategories()],
    ] as const) { respond(body); expect(await run()).toEqual({ state: 'ok', data: body }); }
  });
  it('preserves nulls, absent store and existing unavailable-price fallback', async () => {
    const item = { ...product, description: null, store: undefined, publishedAt: null, variants: [{ ...variant, priceAmountMinor: 'invalid' }], images: [] };
    respond(item);
    expect(await fetchProduct(id)).toEqual({ state: 'ok', data: JSON.parse(JSON.stringify(item)) });
  });
  it.each([null, [], {}, { items: null, nextCursor: null }, { items: [product] }, { items: [product], nextCursor: 3 }, { items: [product, product], nextCursor: null }, { items: [null], nextCursor: null }])('rejects malformed list %#', async body => {
    respond(body); expect(await fetchProducts({})).toEqual({ state: 'unavailable' });
  });
  it.each([
    null, {}, { ...product, id: other }, { ...product, id: '../bad' }, { ...product, title: '' },
    { ...product, description: {} }, { ...product, currency: null }, { ...product, category: {} },
    { ...product, store: { name: 'missing routing fields' } }, { ...product, variants: null }, { ...product, images: {} },
    { ...product, variants: [null] }, { ...product, variants: [{ ...variant, availableToPromise: -1 }] },
    { ...product, variants: [{ ...variant, inStock: false }] }, { ...product, variants: [{ ...variant, inStock: 'true' }] },
    { ...product, variants: [{ ...variant, priceAmountMinor: 123 }] }, { ...product, variants: [{ ...variant, productId: other }] },
    { ...product, variants: [{ ...variant, currency: 'USD' }] }, { ...product, variants: [variant, variant] },
    { ...product, images: [null] }, { ...product, images: [{ ...image, id: 'bad' }] },
    { ...product, images: [{ ...image, altText: {} }] }, { ...product, images: [image, image] },
  ])('rejects malformed or mismatched detail %#', async body => {
    respond(body); expect(await fetchProduct(id)).toEqual({ state: 'unavailable' });
  });
  it.each([null, {}, [null], [{}], [{ ...category, parentId: 'invalid' }], [{ ...category, sortOrder: -1 }], [category, category]])('rejects malformed categories %#', async body => {
    respond(body); expect(await fetchCategories()).toEqual({ state: 'unavailable' });
  });
});
