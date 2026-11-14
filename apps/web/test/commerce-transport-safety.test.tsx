import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ market: vi.fn(), config: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/catalog', () => ({ marketCountryId: mocks.market }));
vi.mock('@/lib/config', () => ({ webConfig: mocks.config }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.session }) }));
import { cartFetch, getOrCreateCart, mutateCart } from '../src/lib/cart';
import { createQuote, readQuote, releaseQuote } from '../src/lib/checkout';
import { POST as cartRoute } from '../src/app/api/cart/items/route';
import { POST as releaseRoute } from '../src/app/api/checkout/quotes/[id]/release/route';

const country = '11111111-1111-4111-8111-111111111111', cartId = '22222222-2222-4222-8222-222222222222', variant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', quoteId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cart = { cartId, countryId: country, currency: 'BDT', version: 1, activeQuoteId: null, items: [] };
const req = { destinationCityId: country, expectedVersion: 1, commandKey: 'web-test-command' };
const response = (status: number, body: unknown = {}) => new Response(status === 204 || status === 205 || status === 304 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', location: 'https://other.example/target' } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.market.mockReturnValue(country); mocks.session.mockReturnValue({ value: 'fixture-session' });
  mocks.config.mockReturnValue({ apiUrl: 'https://api.test', webOrigin: 'https://shop.test', sessionCookieName: 'session' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('bounded cart transport', () => {
  it('sets a timeout, blocks redirects and keeps session and CSRF on same configured API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200)); vi.stubGlobal('fetch', fetchMock);
    await cartFetch('/commerce/carts', { method: 'POST', body: '{}' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test/api/v1/commerce/carts');
    expect(init).toMatchObject({ cache: 'no-store', redirect: 'manual', signal: expect.any(AbortSignal) });
    expect(init.headers.get('cookie')).toBe('session=fixture-session');
    expect(init.headers.get('origin')).toBe('https://shop.test');
    expect(init.headers.get('x-csrf-token')).toBeTruthy();
  });
  it('preserves an upstream caller abort as well as the deadline', async () => {
    const abort = AbortSignal.abort(); const fetchMock = vi.fn().mockResolvedValue(response(200)); vi.stubGlobal('fetch', fetchMock);
    await cartFetch('/commerce/test', { signal: abort });
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);
  });
  it.each([202, 204, 301, 302, 307, 308])('does not use preflight status %s or send a later command', async status => {
    const fetchMock = vi.fn().mockResolvedValue(response(status, cart)); vi.stubGlobal('fetch', fetchMock);
    expect(await getOrCreateCart()).toEqual({ state: 'unavailable' });
    expect(await mutateCart('add', { variantId: variant, quantity: 1 })).toMatchObject({ status: 502, body: { code: 'CART_UNAVAILABLE' } });
    expect(await createQuote(req)).toMatchObject({ status: 502, body: { code: 'QUOTE_UNAVAILABLE' } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each(['add', 'update', 'remove'] as const)('maps redirect, unexpected success and timeout for %s to an uncertain result', async op => {
    for (const status of [202, 204, 301, 302, 307, 308, 408, 500]) {
      const fetchMock = vi.fn().mockResolvedValueOnce(response(201, cart)).mockResolvedValueOnce(response(status, { code: 'PRIVATE_DETAIL' })); vi.stubGlobal('fetch', fetchMock);
      expect(await mutateCart(op, { variantId: variant, quantity: 1, expectedVersion: 1 })).toEqual({ status: 502, body: { code: 'CART_RESULT_UNKNOWN' } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });
  it('maps network failure or aborted body after mutation to unknown without retry', async () => {
    for (const second of [() => Promise.reject(new Error('offline')), () => Promise.resolve({ status: 200, json: async () => { throw Error('timeout'); } })]) {
      const fetchMock = vi.fn().mockResolvedValueOnce(response(201, cart)).mockImplementationOnce(second); vi.stubGlobal('fetch', fetchMock);
      expect(await mutateCart('add', { variantId: variant, quantity: 1 })).toEqual({ status: 502, body: { code: 'CART_RESULT_UNKNOWN' } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });
  it('passes a structured conflict without exposing extra fields, but treats unreadable 4xx as unknown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(201, cart)).mockResolvedValueOnce(response(409, { code: 'CART_VERSION_CONFLICT', message: 'private error' })));
    expect(await mutateCart('add', { variantId: variant, quantity: 1 })).toEqual({ status: 409, body: { code: 'CART_VERSION_CONFLICT' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(201, cart)).mockResolvedValueOnce(response(409, { message: 'private error' })));
    expect(await mutateCart('add', { variantId: variant, quantity: 1 })).toEqual({ status: 502, body: { code: 'CART_RESULT_UNKNOWN' } });
  });
  it('returns a safe 502 from the cart route for a redirect after mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(201, cart)).mockResolvedValueOnce(response(307)); vi.stubGlobal('fetch', fetchMock);
    const r = await cartRoute(new Request('https://shop.test/api/cart/items', { method: 'POST', headers: { origin: 'https://shop.test', 'content-type': 'application/json' }, body: JSON.stringify({ variantId: variant, quantity: 1 }) }));
    expect(r.status).toBe(502); expect(r.headers.get('location')).toBeNull(); expect(await r.json()).toEqual({ code: 'CART_RESULT_UNKNOWN' });
  });
});

describe('bounded checkout quote transport', () => {
  it.each(['create', 'read', 'release'] as const)('maps redirects and invalid statuses for %s to 502', async op => {
    for (const status of [202, 204, 301, 302, 307, 308, 408, 500]) {
      const fetchMock = vi.fn(); if (op === 'create') fetchMock.mockResolvedValueOnce(response(201, cart));
      fetchMock.mockResolvedValueOnce(response(status, { code: 'PRIVATE_DETAIL' })); vi.stubGlobal('fetch', fetchMock);
      const result = op === 'create' ? await createQuote(req) : op === 'read' ? await readQuote(quoteId) : await releaseQuote(quoteId, { version: 1, reason: 'buyer requested' });
      expect(result).toEqual({ status: 502, body: { code: 'QUOTE_UNAVAILABLE' } });
      expect(fetchMock).toHaveBeenCalledTimes(op === 'create' ? 2 : 1);
    }
  });
  it.each(['create', 'read', 'release'] as const)('maps failed %s response body to 502', async op => {
    const fetchMock = vi.fn(); if (op === 'create') fetchMock.mockResolvedValueOnce(response(201, cart));
    fetchMock.mockResolvedValueOnce({ status: op === 'read' ? 200 : 201, json: async () => { throw Error('body timed out'); } }); vi.stubGlobal('fetch', fetchMock);
    const result = op === 'create' ? await createQuote(req) : op === 'read' ? await readQuote(quoteId) : await releaseQuote(quoteId, { version: 1, reason: 'buyer requested' });
    expect(result).toEqual({ status: 502, body: { code: 'QUOTE_UNAVAILABLE' } });
  });
  it('handles a structured conflict and rejects unstructured error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(409, { code: 'CHECKOUT_QUOTE_VERSION_CONFLICT', message: 'private' })).mockResolvedValueOnce(response(409, { detail: 'private' })));
    expect(await releaseQuote(quoteId, { version: 1, reason: 'buyer requested' })).toEqual({ status: 409, body: { code: 'CHECKOUT_QUOTE_VERSION_CONFLICT' } });
    expect(await releaseQuote(quoteId, { version: 1, reason: 'buyer requested' })).toEqual({ status: 502, body: { code: 'QUOTE_UNAVAILABLE' } });
  });
  it('translates upstream 401 to sign in required', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(401, {})));
    expect(await readQuote(quoteId)).toEqual({ status: 401, body: { code: 'SIGN_IN_REQUIRED' } });
  });
  it('returns an uncertain 502 from the release BFF on a redirect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(307)));
    const request = new Request(`https://shop.test/api/checkout/quotes/${quoteId}/release`, { method: 'POST', headers: { origin: 'https://shop.test', 'content-type': 'application/json' }, body: JSON.stringify({ version: 1 }) });
    const res = await releaseRoute(request, { params: Promise.resolve({ id: quoteId }) });
    expect(res.status).toBe(502); expect(await res.json()).toEqual({ code: 'QUOTE_UNAVAILABLE' }); expect(res.headers.get('location')).toBeNull();
  });
});
