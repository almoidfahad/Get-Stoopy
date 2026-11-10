import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/bff', () => ({ apiFetch: mocks.apiFetch }));
import { fetchProducts, fetchProduct, fetchCategories } from '../src/lib/catalog';
import { fetchServiceableCities } from '../src/lib/serviceability';

const country = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const city = { countryId: country, currency: 'BDT', items: [], truncated: false };
const product = { id: productId, title: 'Fixture', description: null, brand: null, currency: 'BDT', category: null, variants: [], images: [], publishedAt: null };
const calls = [
  { name: 'product list', run: () => fetchProducts({}), path: '/public/catalog/products?', body: { items: [product], nextCursor: null } },
  { name: 'categories', run: () => fetchCategories(), path: '/public/catalog/categories?', body: [] },
  { name: 'product detail', run: () => fetchProduct(productId), path: `/public/catalog/products/${productId}?`, body: product },
  { name: 'serviceable cities', run: () => fetchServiceableCities(), path: '/public/serviceability/cities?', body: city },
];
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('MARKET_COUNTRY_ID', country); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe.each(calls)('$name transport', ({ name, run, path, body }) => {
  it('reads HTTP 200 only with a deadline and manual redirects', async () => {
    mocks.apiFetch.mockResolvedValue(Response.json(body));
    expect(await run()).toEqual({ state: 'ok', data: body });
    expect(mocks.apiFetch).toHaveBeenCalledOnce();
    expect(mocks.apiFetch).toHaveBeenCalledWith(expect.stringContaining(path), expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) }));
  });
  it.each([201, 202, 204, 301, 302, 307, 308, 400, 401, 403, 429, 500, 503])('treats HTTP %s as unavailable even if body is plausible', async status => {
    mocks.apiFetch.mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { location: 'https://attacker.example/path' } }));
    expect(await run()).toEqual({ state: 'unavailable' });
  });
  it('does not expose invalid JSON or network errors', async () => {
    mocks.apiFetch.mockResolvedValueOnce(new Response('private error', { status: 200 })).mockRejectedValueOnce(Error('private error'));
    expect(await run()).toEqual({ state: 'unavailable' });
    expect(await run()).toEqual({ state: 'unavailable' });
  });
  it.each(['headers', 'body'])('maps %s abort to unavailable', async part => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort());
    if (part === 'headers') mocks.apiFetch.mockImplementation(async (_path, init) => {
      expect(init.signal.aborted).toBe(true); throw new DOMException('timeout', 'TimeoutError');
    });
    else mocks.apiFetch.mockImplementation(async (_path, init) => ({ status: 200, json: async () => {
      expect(init.signal.aborted).toBe(true); throw new DOMException('timeout', 'TimeoutError');
    } }));
    expect(await run()).toEqual({ state: 'unavailable' });
  });
  it('does not send a request when the market is not configured', async () => {
    vi.stubEnv('MARKET_COUNTRY_ID', '');
    expect(await run()).toEqual({ state: 'not-configured' });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
  it('distinguishes a direct 404 from other errors', async () => {
    mocks.apiFetch.mockResolvedValue(new Response('{}', { status: 404 }));
    expect(await run()).toEqual(name === 'serviceable cities' ? { state: 'unavailable' } : { state: 'not-found' });
  });
});

it('rejects an invalid product ID before network access', async () => {
  expect(await fetchProduct('../private')).toEqual({ state: 'not-found' });
  expect(mocks.apiFetch).not.toHaveBeenCalled();
});
