import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/bff', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/lib/cart', () => ({ hasSessionCookie: mocks.session }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw Error('NEXT_NOT_FOUND'); } }));
import ShopPage from '../src/app/shop/page';
import ProductPage from '../src/app/shop/[id]/page';
const id = '11111111-1111-4111-8111-111111111111';
const item = { id, title: 'Valid item', description: null, brand: null, category: null, currency: 'BDT', variants: [], images: [], publishedAt: null };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('MARKET_COUNTRY_ID', id); mocks.session.mockResolvedValue(false); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('catalog validation at page boundaries', () => {
  it('renders retry instead of an empty or partial catalog for a malformed product', async () => {
    mocks.apiFetch.mockImplementation(async (path: string) => Response.json(path.includes('/categories?') ? [] : { items: [item, { ...item, variants: null }], nextCursor: null }));
    const html = renderToStaticMarkup(await ShopPage({ searchParams: Promise.resolve({ q: 'chair' }) }));
    expect(html).toContain('Catalog unavailable'); expect(html).toContain('/shop?q=chair');
    expect(html).not.toContain('No products found'); expect(html).not.toContain('Valid item');
  });
  it('keeps valid products visible and shows categories unavailable for malformed categories', async () => {
    mocks.apiFetch.mockImplementation(async (path: string) => Response.json(path.includes('/categories?') ? [{}] : { items: [item], nextCursor: null }));
    const html = renderToStaticMarkup(await ShopPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Categories are temporarily unavailable'); expect(html).toContain('Valid item');
  });
  it('renders product recovery without attempting cart session reads on malformed detail', async () => {
    mocks.apiFetch.mockResolvedValue(Response.json({ ...item, variants: [null] }));
    const html = renderToStaticMarkup(await ProductPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ q: 'chair' }) }));
    expect(html).toContain('unavailable'); expect(html).toContain('/shop?q=chair');
    expect(html).not.toContain('Add to cart'); expect(mocks.session).not.toHaveBeenCalled();
  });
});
