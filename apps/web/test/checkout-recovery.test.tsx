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

const item = { id: 'item', variantId: 'variant', productId: 'product', title: 'Rice', storeName: 'Store', storeId: 'store', vendorId: 'vendor', quantity: 1, unitPriceMinor: '100', lineTotalMinor: '100', currency: 'BDT', availableToPromise: 0, sellable: true };
const cart = { cartId: 'cart', countryId: 'country', currency: 'BDT', version: 1, activeQuoteId: 'quote', items: [item] };
const quote = { quoteId: 'quote', state: 'RESERVED' };
const cities = { state: 'ok', data: { countryId: 'country', currency: 'BDT', items: [{ cityId: 'city', name: 'City', code: 'C', storeCount: 1 }], truncated: false } };

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
    expect(html).toContain('quote|Your cart is not ready');
    expect(mocks.quote).toHaveBeenCalledWith('quote');
  });

  it.each(['unavailable', 'not-configured'] as const)('keeps recovery available when cities are %s', async state => {
    mocks.cart.mockResolvedValue({ state: 'ok', cart: { ...cart, items: [{ ...item, availableToPromise: 2 }] } });
    mocks.cities.mockResolvedValue({ state });
    expect(renderToStaticMarkup(await CheckoutPage())).toContain('quote|Delivery cities could not be loaded');
  });

  it('keeps recovery available when no city is currently serviceable', async () => {
    mocks.cart.mockResolvedValue({ state: 'ok', cart: { ...cart, items: [{ ...item, availableToPromise: 2 }] } });
    mocks.cities.mockResolvedValue({ ...cities, data: { ...cities.data, items: [] } });
    expect(renderToStaticMarkup(await CheckoutPage())).toContain('quote|No delivery cities are currently available');
  });

  it('warns rather than silently hiding a quote that could not be loaded', async () => {
    mocks.quote.mockResolvedValue({ status: 502, body: {} });
    const html = renderToStaticMarkup(await CheckoutPage());
    expect(html).toContain('Reserved quote unavailable');
    expect(html).toContain('reservation may still be active');
    expect(html).toMatch(/<a href="\/checkout"[^>]*>Try again<\/a>/);
    expect(mocks.cities).not.toHaveBeenCalled();
  });

  it('still blocks a new quote for an invalid cart without a reservation', async () => {
    mocks.cart.mockResolvedValue({ state: 'ok', cart: { ...cart, activeQuoteId: null } });
    expect(renderToStaticMarkup(await CheckoutPage())).toContain('Resolve your cart first');
    expect(mocks.quote).not.toHaveBeenCalled();
  });
});
