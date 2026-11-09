import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ market: vi.fn(), api: vi.fn(), cart: vi.fn(), quote: vi.fn() }));
vi.mock('@/lib/catalog', () => ({ marketCountryId: mocks.market }));
vi.mock('@/lib/bff', () => ({ apiFetch: mocks.api }));
vi.mock('@/lib/cart', () => ({ getOrCreateCart: mocks.cart }));
vi.mock('@/lib/checkout', () => ({ readQuote: mocks.quote }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { fetchServiceableCities } from '../src/lib/serviceability';
import CheckoutPage from '../src/app/checkout/page';

const country = '11111111-1111-4111-8111-111111111111';
const quoteId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cartId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const cityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const city = { cityId, name: 'Dhaka', code: 'DHK', storeCount: 1 };
const cities = { countryId: country, currency: 'BDT', items: [city], truncated: false };
const item = { id: 'item', variantId: 'variant', productId: 'product', title: 'Item', storeName: 'Store', storeId: 'store', vendorId: 'vendor', quantity: 1, unitPriceMinor: '100', lineTotalMinor: '100', currency: 'BDT', availableToPromise: 1, sellable: true };
const cart = { cartId: cartId, countryId: country, currency: 'BDT', version: 1, activeQuoteId: null, items: [item] };
const quote = { quoteId: quoteId, cartId: cartId, currency: 'BDT', state: 'RESERVED', destinationCityId: cityId, subtotalMinor: '100', version: 1, expiresAt: '2100-01-01T00:00:00Z', closedAt: null, deliveryFeeMinor: null, totalMinor: null, paymentStatus: 'NOT_IMPLEMENTED', groups: [], items: [] };
function reply(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); }
beforeEach(() => { vi.clearAllMocks(); mocks.market.mockReturnValue(country); mocks.cart.mockResolvedValue({ state: 'ok', cart }); mocks.quote.mockResolvedValue({ status: 200, body: quote }); });
afterEach(() => vi.unstubAllGlobals());

describe('public delivery-city response validation', () => {
  it('accepts a valid list, an empty list and case-equivalent country ids', async () => {
    mocks.api.mockResolvedValueOnce(reply(cities)).mockResolvedValueOnce(reply({ ...cities, items: [], truncated: true }))
      .mockResolvedValueOnce(reply({ ...cities, countryId: country.toUpperCase(), items: [{ ...city, cityId: cityId.toUpperCase() }] }));
    expect(await fetchServiceableCities()).toEqual({ state: 'ok', data: cities });
    expect(await fetchServiceableCities()).toMatchObject({ state: 'ok', data: { items: [], truncated: true } });
    expect(await fetchServiceableCities()).toEqual({ state: 'ok', data: cities });
    expect(mocks.api.mock.calls[0]![0]).toBe(`/public/serviceability/cities?countryId=${country}`);
  });
  it.each([
    ['null', null], ['missing items', { ...cities, items: undefined }], ['wrong country', { ...cities, countryId: '99999999-9999-4999-8999-999999999999' }],
    ['missing currency', { ...cities, currency: undefined }], ['blank currency', { ...cities, currency: ' ' }], ['missing truncation flag', { ...cities, truncated: undefined }],
    ['non-boolean truncation', { ...cities, truncated: 'false' }], ['null city', { ...cities, items: [null] }],
    ['bad city ID', { ...cities, items: [{ ...city, cityId: '../bad' }] }], ['missing name', { ...cities, items: [{ ...city, name: undefined }] }],
    ['empty name', { ...cities, items: [{ ...city, name: '  ' }] }], ['non-text code', { ...cities, items: [{ ...city, code: {} }] }],
    ['missing store count', { ...cities, items: [{ ...city, storeCount: undefined }] }], ['zero stores', { ...cities, items: [{ ...city, storeCount: 0 }] }],
    ['fractional count', { ...cities, items: [{ ...city, storeCount: 1.5 }] }], ['unsafe count', { ...cities, items: [{ ...city, storeCount: Number.MAX_SAFE_INTEGER + 1 }] }],
    ['duplicate ID', { ...cities, items: [city, { ...city, cityId: cityId.toUpperCase(), name: 'Another city' }] }],
  ])('fails safely for %s', async (_name, body) => {
    mocks.api.mockResolvedValue(reply(body));
    expect(await fetchServiceableCities()).toEqual({ state: 'unavailable' });
  });
  it('distinguishes not-configured, error status, invalid JSON and network errors', async () => {
    mocks.market.mockReturnValueOnce(null);
    expect(await fetchServiceableCities()).toEqual({ state: 'not-configured' });
    expect(mocks.api).not.toHaveBeenCalled();
    mocks.api.mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(new Response('bad', { status: 200 })).mockRejectedValueOnce(new Error('offline'));
    expect(await fetchServiceableCities()).toEqual({ state: 'unavailable' });
    expect(await fetchServiceableCities()).toEqual({ state: 'unavailable' });
    expect(await fetchServiceableCities()).toEqual({ state: 'unavailable' });
  });
  it('shows a recoverable unavailable state rather than a selectable invalid destination', async () => {
    mocks.api.mockResolvedValue(reply({ ...cities, items: [null] }));
    const html = renderToStaticMarkup(await CheckoutPage());
    expect(html).toContain('Delivery cities unavailable');
    expect(html).toContain('Try again');
    expect(html).not.toContain('Reserve stock and get quote');
  });
  it('keeps an existing quote available for recovery when city data is malformed', async () => {
    mocks.cart.mockResolvedValue({ state: 'ok', cart: { ...cart, activeQuoteId: quoteId } });
    mocks.api.mockResolvedValue(reply({ ...cities, items: [null] }));
    const html = renderToStaticMarkup(await CheckoutPage());
    expect(html).toContain('Delivery cities could not be loaded. Reload the page before requesting a new quote.');
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(html).toContain('Reserve stock and get quote');
    expect(mocks.quote).toHaveBeenCalledWith(quoteId);
  });
});
