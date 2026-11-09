import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ cart: vi.fn(), quote: vi.fn(), cities: vi.fn() }));
vi.mock('@/lib/cart', () => ({ getOrCreateCart: mocks.cart }));
vi.mock('@/lib/checkout', () => ({ readQuote: mocks.quote }));
vi.mock('@/lib/serviceability', () => ({ fetchServiceableCities: mocks.cities }));
vi.mock('@/components/checkout-panel', () => ({
  CheckoutPanel: (props: { initialQuote: { quoteId: string } | null; reservationUnavailable: string | null }) =>
    React.createElement('div', { 'data-testid': 'panel' }, `${props.initialQuote?.quoteId ?? 'none'}|${props.reservationUnavailable ?? 'ready'}`),
}));
vi.mock('@/components/cart-controls', () => ({ CartLineControls: () => null }));

import CheckoutPage from '../src/app/checkout/page';
import CartPage from '../src/app/cart/page';

const quoteId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const cartId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cityId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const item = { id: 'item', variantId: 'variant', productId: 'product', title: 'Rice', storeName: 'Store', storeId: 'store', vendorId: 'vendor', quantity: 1, unitPriceMinor: '100', lineTotalMinor: '100', currency: 'BDT', availableToPromise: 0, sellable: true };
const cart = { cartId: cartId, countryId: 'country', currency: 'BDT', version: 1, activeQuoteId: quoteId, items: [item] };
const quote = { quoteId: quoteId, cartId: cartId, currency: 'BDT', state: 'RESERVED', destinationCityId: cityId, subtotalMinor: '100', version: 1, expiresAt: '2100-01-01T00:00:00Z', closedAt: null, deliveryFeeMinor: null, totalMinor: null, paymentStatus: 'NOT_IMPLEMENTED', groups: [], items: [] };
const cities = { state: 'ok', data: { countryId: 'country', currency: 'BDT', items: [{ cityId: cityId, name: 'City', code: 'C', storeCount: 1 }], truncated: false } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cart.mockResolvedValue({ state: 'ok', cart });
  mocks.quote.mockResolvedValue({ status: 200, body: quote });
  mocks.cities.mockResolvedValue(cities);
});

describe('reserved quote recovery', () => {
  it('provides a recovery link from a cart whose available stock is already reserved', async () => {
    const html = renderToStaticMarkup(await CartPage());
    expect(html).toContain('View or release the quote');
    expect(html).toContain('View reserved quote');
    expect(html).toContain('href="/checkout"');
  });

  it('provides a recovery link even if the cart is empty', async () => {
    mocks.cart.mockResolvedValue({ state: 'ok', cart: { ...cart, items: [] } });
    expect(renderToStaticMarkup(await CartPage())).toContain('View or release the quote');
  });

  it('shows the reserved quote despite insufficient stock in the current cart', async () => {
    const html = renderToStaticMarkup(await CheckoutPage());
    expect(html).toContain(`${quoteId}|Your cart is not ready`);
    expect(mocks.quote).toHaveBeenCalledWith(quoteId);
  });

  it.each(['unavailable', 'not-configured'] as const)('keeps recovery available when cities are %s', async state => {
    mocks.cart.mockResolvedValue({ state: 'ok', cart: { ...cart, items: [{ ...item, availableToPromise: 2 }] } });
    mocks.cities.mockResolvedValue({ state });
    expect(renderToStaticMarkup(await CheckoutPage())).toContain(`${quoteId}|Delivery cities could not be loaded`);
  });

  it('keeps recovery available when no city is currently serviceable', async () => {
    mocks.cart.mockResolvedValue({ state: 'ok', cart: { ...cart, items: [{ ...item, availableToPromise: 2 }] } });
    mocks.cities.mockResolvedValue({ ...cities, data: { ...cities.data, items: [] } });
    expect(renderToStaticMarkup(await CheckoutPage())).toContain(`${quoteId}|No delivery cities are currently available`);
  });

  it('warns rather than silently hiding a quote that could not be loaded', async () => {
    mocks.quote.mockResolvedValue({ status: 502, body: {} });
    const html = renderToStaticMarkup(await CheckoutPage());
    expect(html).toContain('Reserved quote unavailable');
    expect(html).toContain('reservation may still be active');
    expect(html).toMatch(/<a href="\/checkout"[^>]*>Try again<\/a>/);
    expect(mocks.cities).not.toHaveBeenCalled();
  });

  it.each([
    ['missing fields', {}],
    ['invalid quote ID', { ...quote, quoteId: '../bad-quote' }],
    ['invalid cart ID', { ...quote, cartId: 'bad-cart' }],
    ['invalid city ID', { ...quote, destinationCityId: 'bad-city' }],
    ['wrong quote', { ...quote, quoteId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }],
    ['wrong cart', { ...quote, cartId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }],
    ['unknown state', { ...quote, state: 'NEW_STATE' }],
    ['malformed item', { ...quote, items: [{ itemId: 'bad' }] }],
    ['invalid version', { ...quote, version: 0 }],
    ['unsafe version', { ...quote, version: Number.MAX_SAFE_INTEGER + 1 }],
  ])('shows a recovery notice instead of adopting a %s response', async (_label, body) => {
    mocks.quote.mockResolvedValue({ status: 200, body });
    const html = renderToStaticMarkup(await CheckoutPage());
    expect(html).toContain('Reserved quote unavailable');
    expect(html).toContain('reservation may still be active');
    expect(html).toContain('Try again');
    expect(html).not.toContain('data-testid="panel"');
    expect(mocks.cities).not.toHaveBeenCalled();
  });
  it('accepts equivalent case for recovered quote and cart identifiers', async () => {
    mocks.cart.mockResolvedValue({ state: 'ok', cart: { ...cart, cartId: cartId.toUpperCase(), activeQuoteId: quoteId.toUpperCase() } });
    const html = renderToStaticMarkup(await CheckoutPage());
    expect(html).toContain(`${quoteId}|Your cart is not ready`);
  });
  it('still blocks a new quote for an invalid cart without a reservation', async () => {
    mocks.cart.mockResolvedValue({ state: 'ok', cart: { ...cart, activeQuoteId: null } });
    expect(renderToStaticMarkup(await CheckoutPage())).toContain('Resolve your cart first');
    expect(mocks.quote).not.toHaveBeenCalled();
  });
});
