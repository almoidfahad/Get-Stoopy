import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ cart: vi.fn(), quote: vi.fn(), cities: vi.fn() }));
vi.mock('@/lib/cart', () => ({ getOrCreateCart: mocks.cart }));
vi.mock('@/lib/checkout', () => ({ readQuote: mocks.quote }));
vi.mock('@/lib/serviceability', () => ({ fetchServiceableCities: mocks.cities }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import CartPage from '../src/app/cart/page';
import CheckoutPage from '../src/app/checkout/page';

const item = { id: 'item', variantId: 'variant', productId: 'product', title: 'Real item', storeName: 'Real store', storeId: 'store', vendorId: 'vendor', quantity: 2, unitPriceMinor: '100', lineTotalMinor: '200', currency: 'BDT', availableToPromise: 4, sellable: true };
const cart = { cartId: 'cart', countryId: 'country', currency: 'BDT', version: 1, activeQuoteId: null, items: [item] };
const cities = { state: 'ok', data: { countryId: 'country', currency: 'BDT', items: [{ cityId: 'city', name: 'City', code: 'C', storeCount: 1 }], truncated: false } };
beforeEach(() => { vi.clearAllMocks(); mocks.cart.mockResolvedValue({ state: 'ok', cart }); mocks.cities.mockResolvedValue(cities); });

describe('cart and checkout UI', () => {
  it.each(['not-configured', 'unavailable', 'sign-in'] as const)('shows the cart %s state without a demo cart', async state => {
    mocks.cart.mockResolvedValue({ state });
    const html = renderToStaticMarkup(await CartPage());
    expect(html).toContain(state === 'not-configured' ? 'Market not configured' : state === 'sign-in' ? 'Sign in to view your cart' : 'Cart unavailable');
    expect(html).toContain('Browse products');
    expect(html).not.toContain('Real item');
    if (state === 'sign-in') expect(html).toContain('href="/login"');
  });
  it('shows an empty cart and retains the shop link', async () => {
    mocks.cart.mockResolvedValue({ state: 'ok', cart: { ...cart, items: [] } });
    const html = renderToStaticMarkup(await CartPage());
    expect(html).toContain('Your cart is empty');
    expect(html).toContain('href="/shop"');
    expect(html).not.toContain('Continue to checkout');
  });
  it('shows real items, accessible item-specific controls and only a subtotal', async () => {
    const html = renderToStaticMarkup(await CartPage());
    expect(html).toContain('Real item');
    expect(html).toContain('Real store');
    expect(html).toContain('aria-label="Decrease quantity for Real item"');
    expect(html).toContain('aria-label="Remove Real item from cart"');
    expect(html).toContain('Continue to checkout');
    expect(html).toContain('Not calculated yet');
    expect(html).toContain('no money is taken');
  });
  it('withholds inconsistent line and subtotal amounts without hiding the issue', async () => {
    mocks.cart.mockResolvedValue({ state: 'ok', cart: { ...cart, items: [{ ...item, lineTotalMinor: '99999' }] } });
    const html = renderToStaticMarkup(await CartPage());
    expect(html).toContain('Line total unavailable');
    expect(html).toContain('The price changed while you were shopping');
    expect(html).toMatch(/Subtotal<\/dt><dd[^>]*>Unavailable/);
    expect(html).not.toContain('999.99');
    expect(html).toContain('Checkout unavailable');
  });
  it('fails safely when an item currency is malformed', async () => {
    mocks.cart.mockResolvedValue({ state: 'ok', cart: { ...cart, items: [{ ...item, currency: '' }] } });
    const html = renderToStaticMarkup(await CartPage());
    expect(html).toContain('currency for this item is unavailable');
    expect(html).toContain('Unit price unavailable');
    expect(html).toContain('Line total unavailable');
    expect(html).toContain('Checkout unavailable');
  });
  it('blocks new checkout when an item is unavailable', async () => {
    mocks.cart.mockResolvedValue({ state: 'ok', cart: { ...cart, items: [{ ...item, availableToPromise: 0 }] } });
    const html = renderToStaticMarkup(await CartPage());
    expect(html).toContain('Requested quantity is no longer in stock');
    expect(html).toContain('Checkout unavailable');
    expect(html).not.toContain('Continue to checkout');
  });
  it('links the preview while asking the buyer to resolve cart issues', async () => {
    mocks.cart.mockResolvedValue({ state: 'ok', cart: { ...cart, items: [{ ...item, availableToPromise: 0 }] } });
    const html = renderToStaticMarkup(await CheckoutPage());
    expect(html).toContain('Resolve your cart first');
    expect(html).toContain('href="/checkout/recipient-preview"');
    expect(html).toContain('not an order form');
  });
  it('shows the delivery city and disabled payment with no invented totals', async () => {
    const html = renderToStaticMarkup(await CheckoutPage());
    expect(html).toContain('Choose a city');
    expect(html).toContain('City — 1 store');
    expect(html).toContain('Reserve stock and get quote');
    expect(html).toContain('Not quoted yet');
    expect(html).toContain('Payment not available');
    expect(html).toContain('no money');
    expect(html).toContain('href="/checkout/recipient-preview"');
    expect(html).toContain('does not change this quote');
  });
  it('shows an explicit unconfigured checkout rather than sample cities', async () => {
    mocks.cart.mockResolvedValue({ state: 'not-configured' });
    const html = renderToStaticMarkup(await CheckoutPage());
    expect(html).toContain('Market not configured');
    expect(html).toContain('Back to cart');
    expect(html).toContain('href="/checkout/recipient-preview"');
    expect(html).toContain('not an order form');
    expect(html).not.toContain('Choose a city');
  });
});
