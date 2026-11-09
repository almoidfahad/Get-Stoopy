import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ market: vi.fn(), config: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/catalog', () => ({ marketCountryId: mocks.market }));
vi.mock('@/lib/config', () => ({ webConfig: mocks.config }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.session }) }));
import { getOrCreateCart, mutateCart } from '../src/lib/cart';
import { createQuote } from '../src/lib/checkout';

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
  it('sends a mutation with the validated cart identity and version', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(cart)).mockResolvedValueOnce(reply({ ok: true })); vi.stubGlobal('fetch', fetchMock);
    const result = await mutateCart('add', { variantId: variant, quantity: 1 });
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toBe(`https://api.test/api/v1/commerce/carts/${cartId}/items`);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ variantId: variant, quantity: 1, expectedVersion: 1 });
  });
});
