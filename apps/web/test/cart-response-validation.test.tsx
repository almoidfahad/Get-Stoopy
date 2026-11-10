import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ market: vi.fn(), config: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/catalog', () => ({ marketCountryId: mocks.market }));
vi.mock('@/lib/config', () => ({ webConfig: mocks.config }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.session }) }));
import { getOrCreateCart, mutateCart } from '../src/lib/cart';
import { createQuote } from '../src/lib/checkout';
import { POST } from '../src/app/api/cart/items/route';

const country = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const variant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const item = {
  id: '33333333-3333-4333-8333-333333333333', variantId: variant,
  productId: '44444444-4444-4444-8444-444444444444', storeId: '55555555-5555-4555-8555-555555555555',
  vendorId: '66666666-6666-4666-8666-666666666666', title: 'Item', storeName: 'Store',
  quantity: 2, unitPriceMinor: '100', lineTotalMinor: '200', currency: 'BDT', availableToPromise: 2, sellable: true,
};
const cart = { cartId, countryId: country, currency: 'BDT', version: 1, activeQuoteId: null, items: [item] };
function reply(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.market.mockReturnValue(country); mocks.session.mockReturnValue({ value: 'test-session' });
  mocks.config.mockReturnValue({ apiUrl: 'https://api.test', webOrigin: 'https://shop.test', sessionCookieName: 'session' });
});
afterEach(() => vi.unstubAllGlobals());

describe('cart API response validation', () => {
  it('accepts an empty or populated cart for the configured market', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply({ ...cart, items: [] })).mockResolvedValueOnce(reply({ ...cart, countryId: country.toUpperCase() }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getOrCreateCart()).toMatchObject({ state: 'ok', cart: { items: [] } });
    expect(await getOrCreateCart()).toMatchObject({ state: 'ok', cart: { cartId } });
  });
  it('lets pricing, availability and quantity issues reach the existing cart summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ ...cart, items: [{ ...item, currency: '', quantity: 0, unitPriceMinor: 'bad', availableToPromise: 0, sellable: false }] })));
    expect(await getOrCreateCart()).toMatchObject({ state: 'ok' });
  });
  it.each([
    ['null', null],
    ['missing items', { ...cart, items: undefined }],
    ['missing active quote', { ...cart, activeQuoteId: undefined }],
    ['bad quote id', { ...cart, activeQuoteId: 'x' }],
    ['wrong market', { ...cart, countryId: '99999999-9999-4999-8999-999999999999' }],
    ['invalid cart id', { ...cart, cartId: 'cart/../quotes' }],
    ['invalid version', { ...cart, version: 0 }],
    ['unsafe version', { ...cart, version: Number.MAX_SAFE_INTEGER + 1 }],
    ['null item', { ...cart, items: [null] }],
    ['missing variant', { ...cart, items: [{ ...item, variantId: undefined }] }],
    ['bad product id', { ...cart, items: [{ ...item, productId: '../cart' }] }],
    ['bad title', { ...cart, items: [{ ...item, title: {} }] }],
    ['bad price type', { ...cart, items: [{ ...item, unitPriceMinor: 100 }] }],
    ['missing availability', { ...cart, items: [{ ...item, availableToPromise: undefined }] }],
    ['bad availability', { ...cart, items: [{ ...item, availableToPromise: -1 }] }],
    ['sellable string', { ...cart, items: [{ ...item, sellable: 'false' }] }],
    ['duplicate line', { ...cart, items: [item, item] }],
    ['duplicate variant', { ...cart, items: [item, { ...item, id: '77777777-7777-4777-8777-777777777777', variantId: variant.toUpperCase() }] }],
  ])('fails closed for %s', async (_name, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body)));
    expect(await getOrCreateCart()).toEqual({ state: 'unavailable' });
  });
  it('returns unavailable on malformed JSON or network error, and retains signed-out handling', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('bad json', { status: 200 })).mockRejectedValueOnce(new Error('offline')));
    expect(await getOrCreateCart()).toEqual({ state: 'unavailable' });
    expect(await getOrCreateCart()).toEqual({ state: 'unavailable' });
    mocks.session.mockReturnValue(undefined);
    expect(await getOrCreateCart()).toEqual({ state: 'sign-in' });
  });
  it('treats an expired or invalid session rejected by the cart API as sign-in required', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'UNAUTHENTICATED' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getOrCreateCart()).toEqual({ state: 'sign-in' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([403, 429, 500, 503])('does not mistake HTTP %s for sign-out', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
    expect(await getOrCreateCart()).toEqual({ state: 'unavailable' });
  });
  it.each(['add', 'update', 'remove'] as const)('does not issue %s after the cart preflight returns 401', async op => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await mutateCart(op, { variantId: variant, quantity: 1, expectedVersion: 1 })).toEqual({ status: 401, body: { code: 'SIGN_IN_REQUIRED' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not issue a quote request after the cart preflight returns 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await createQuote({ destinationCityId: country, expectedVersion: 1, commandKey: 'web-test' })).toEqual({ status: 401, body: { code: 'SIGN_IN_REQUIRED' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('returns a sign-in response through the cart BFF instead of a mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const req = new Request('https://shop.test/api/cart/items', { method: 'POST', headers: { origin: 'https://shop.test', 'content-type': 'application/json' }, body: JSON.stringify({ variantId: variant, quantity: 1 }) });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'SIGN_IN_REQUIRED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(['add', 'update', 'remove'] as const)('does not send a %s mutation when cart data is malformed', async op => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ ...cart, items: [null] })); vi.stubGlobal('fetch', fetchMock);
    expect(await mutateCart(op, { variantId: variant, quantity: 1, expectedVersion: 1 })).toMatchObject({ status: 502, body: { code: 'CART_UNAVAILABLE' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not send a quote request when cart data is malformed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ ...cart, activeQuoteId: undefined })); vi.stubGlobal('fetch', fetchMock);
    expect(await createQuote({ destinationCityId: country, expectedVersion: 1, commandKey: 'web-test' })).toMatchObject({ status: 502, body: { code: 'QUOTE_UNAVAILABLE' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(['null', 'invalid-json', 'wrong-cart', 'wrong-market', 'old-version', 'missing-item', 'wrong-quantity', 'malformed-cart'] as const)(
    'returns an unknown outcome when an add responds with %s', async kind => {
      const result = { ...cart, version: kind === 'old-version' ? 1 : 2,
        cartId: kind === 'wrong-cart' ? '88888888-8888-4888-8888-888888888888' : cartId,
        countryId: kind === 'wrong-market' ? '99999999-9999-4999-8999-999999999999' : country,
        items: kind === 'missing-item' ? [] : kind === 'malformed-cart' ? [null] : [{ ...item, quantity: kind === 'wrong-quantity' ? 2 : 3, lineTotalMinor: '300' }] };
      const second = kind === 'invalid-json' ? new Response('bad json', { status: 200 }) : reply(kind === 'null' ? null : result);
      const fetchMock = vi.fn().mockResolvedValueOnce(reply(cart)).mockResolvedValueOnce(second); vi.stubGlobal('fetch', fetchMock);
      expect(await mutateCart('add', { variantId: variant, quantity: 1 })).toEqual({ status: 502, body: { code: 'CART_RESULT_UNKNOWN' } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
  it('confirms an add of a new item, an update and a removal only with matching results', async () => {
    const empty = { ...cart, items: [] };
    const added = { ...cart, version: 2, items: [{ ...item, quantity: 1, lineTotalMinor: '100' }] };
    const updated = { ...cart, version: 2, items: [{ ...item, quantity: 3, lineTotalMinor: '300' }] };
    const removed = { ...cart, version: 2, items: [] };
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(empty)).mockResolvedValueOnce(reply(added))
      .mockResolvedValueOnce(reply(cart)).mockResolvedValueOnce(reply(updated))
      .mockResolvedValueOnce(reply(cart)).mockResolvedValueOnce(reply(removed)); vi.stubGlobal('fetch', fetchMock);
    expect(await mutateCart('add', { variantId: variant, quantity: 1 })).toMatchObject({ status: 200, body: { mutationConfirmed: true } });
    expect(await mutateCart('update', { variantId: variant, quantity: 3, expectedVersion: 1 })).toMatchObject({ status: 200, body: { mutationConfirmed: true } });
    expect(await mutateCart('remove', { variantId: variant, expectedVersion: 1 })).toMatchObject({ status: 200, body: { mutationConfirmed: true } });
  });
  it.each(['update', 'remove'] as const)('rejects a 2xx %s with an inconsistent item result', async op => {
    const result = { ...cart, version: 2, items: [{ ...item, quantity: 2 }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(cart)).mockResolvedValueOnce(reply(result)));
    expect(await mutateCart(op, { variantId: variant, quantity: 3, expectedVersion: 1 })).toEqual({ status: 502, body: { code: 'CART_RESULT_UNKNOWN' } });
  });
  it('preserves a definitive 409 response without confirming or retrying it', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(cart)).mockResolvedValueOnce(new Response(JSON.stringify({ code: 'CART_VERSION_CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await mutateCart('remove', { variantId: variant, expectedVersion: 1 })).toEqual({ status: 409, body: { code: 'CART_VERSION_CONFLICT' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('exposes uncertain or confirmed outcomes through the actual BFF route', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(cart)).mockResolvedValueOnce(reply({}))
      .mockResolvedValueOnce(reply(cart)).mockResolvedValueOnce(reply({ ...cart, version: 2, items: [{ ...item, quantity: 3, lineTotalMinor: '300' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const makeRequest = () => new Request('https://shop.test/api/cart/items', { method: 'POST', headers: { origin: 'https://shop.test', 'content-type': 'application/json' }, body: JSON.stringify({ variantId: variant, quantity: 1 }) });
    const unknown = await POST(makeRequest());
    expect(unknown.status).toBe(502);
    expect(await unknown.json()).toEqual({ code: 'CART_RESULT_UNKNOWN' });
    const confirmed = await POST(makeRequest());
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ cartId, mutationConfirmed: true });
  });
  it('sends a mutation with the validated cart identity and version', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(cart)).mockResolvedValueOnce(reply({ ...cart, version: 2, items: [{ ...item, quantity: 3, lineTotalMinor: '300' }] })); vi.stubGlobal('fetch', fetchMock);
    const result = await mutateCart('add', { variantId: variant, quantity: 1 });
    expect(result).toMatchObject({ status: 200, body: { cartId, mutationConfirmed: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toBe(`https://api.test/api/v1/commerce/carts/${cartId}/items`);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ variantId: variant, quantity: 1, expectedVersion: 1 });
  });
});
