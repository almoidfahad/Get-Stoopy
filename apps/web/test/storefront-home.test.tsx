import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ products: vi.fn(), webConfig: vi.fn() }));
vi.mock('@/lib/config', () => ({ webConfig: mocks.webConfig }));
vi.mock('@/lib/catalog', () => ({ fetchProducts: mocks.products, imageProxyUrl: () => '/image' }));
import Home from '../src/app/page';
import Login from '../src/app/login/page';

beforeEach(() => { vi.resetAllMocks(); mocks.webConfig.mockReturnValue({}); });

describe('storefront UI', () => {
  it.each(['not-configured', 'unavailable'] as const)('shows an honest empty collection when the catalog is %s', async state => {
    mocks.products.mockResolvedValue({ state });
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain(state === 'not-configured' ? 'Our shop is getting ready' : 'The collection is temporarily unavailable');
    expect(html).toContain(state === 'not-configured' ? 'Products aren’t available to browse here yet.' : 'We couldn’t load products right now.');
    expect(html).not.toContain('Up to 70%');
    expect(html).toContain('action="/shop"');
    expect(html).toContain('Skip to content');
    expect(html).toContain('aria-label="Account"');
    expect(html).toContain('aria-label="Cart"');
    expect(html).toContain('<span class="text-red-300">Stoopy</span>');
  });

  it('distinguishes an empty successful catalog from a service outage', async () => {
    mocks.products.mockResolvedValue({ state: 'ok', data: { items: [], nextCursor: null } });
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('No products to show yet');
    expect(html).not.toContain('temporarily unavailable');
  });

  it('renders real catalog items instead of placeholder products', async () => {
    mocks.products.mockResolvedValue({ state: 'ok', data: { items: [{ id: 'p', title: 'Real product', currency: 'BDT', variants: [], images: [] }], nextCursor: null } });
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('Real product');
    expect(html).not.toContain('No products to show yet');
    expect(html).toContain('/shop/p');
  });

  it('shows the existing sign-in action and accessible error state without invented provider buttons', async () => {
    const html = renderToStaticMarkup(await Login({ searchParams: Promise.resolve({ error: 'failed' }) }));
    expect(html).toContain('/api/auth/login');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('Continue with Google');
    expect(html.indexOf('id="login-heading"')).toBeLessThan(html.indexOf('aria-label="Welcome to Get Stoopy"'));
    expect(html).toContain('Continue browsing');
  });
  it('does not offer a broken sign-in action when configuration is missing', async () => {
    mocks.webConfig.mockImplementation(() => { throw new Error('secret configuration detail'); });
    const html = renderToStaticMarkup(await Login({ searchParams: Promise.resolve({ error: 'oidc' }) }));
    expect(html).toContain('Sign-in is not available yet');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('href="/api/auth/login"');
    expect(html).not.toContain('secret configuration detail');
    expect(html).toContain('href="/shop"');
  });
  it('shows a safe recovery message when sign-in cannot start', async () => {
    const html = renderToStaticMarkup(await Login({ searchParams: Promise.resolve({ error: 'unavailable' }) }));
    expect(html).toContain('Sign-in service unavailable');
    expect(html).toContain('not configured');
    expect(html).toContain('href="/shop"');
  });
});
