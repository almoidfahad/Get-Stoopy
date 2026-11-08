import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ products: vi.fn(), categories: vi.fn() }));
vi.mock('@/lib/catalog', () => ({ fetchProducts: mocks.products, fetchCategories: mocks.categories, imageProxyUrl: () => '/image' }));
import ShopPage from '../src/app/shop/page';

const category = { id: 'cat-1', name: 'Home & Living', slug: 'home', parentId: null, description: null, sortOrder: 0 };
async function render(params: Record<string, string | string[]> = {}) {
  return renderToStaticMarkup(await ShopPage({ searchParams: Promise.resolve(params) }));
}
beforeEach(() => { vi.resetAllMocks(); mocks.categories.mockResolvedValue({ state: 'ok', data: [category] }); });

describe('shop page', () => {
  it('uses real search and category data, preserving filters in pagination', async () => {
    mocks.products.mockResolvedValue({ state: 'ok', data: { items: [{ id: 'p1', title: 'A real product', currency: 'BDT', variants: [], images: [] }], nextCursor: 'next cursor' } });
    const html = await render({ q: 'chair & table', categoryId: 'cat-1' });
    expect(mocks.products).toHaveBeenCalledWith({ q: 'chair & table', categoryId: 'cat-1', cursor: undefined });
    expect(html).toContain('A real product');
    expect(html).toContain('Home &amp; Living');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('name="categoryId" value="cat-1"');
    expect(html).toContain('q=chair+%26+table&amp;categoryId=cat-1&amp;cursor=next+cursor');
    expect(html).toContain('rel="next"');
  });

  it.each(['not-configured', 'unavailable'] as const)('shows %s honestly without demo products', async state => {
    mocks.products.mockResolvedValue({ state });
    const html = await render();
    expect(html).toContain(state === 'not-configured' ? 'Market not configured' : 'Catalog unavailable');
    expect(html).not.toContain('A real product');
  });

  it('explains an empty category and allows clearing filters', async () => {
    mocks.products.mockResolvedValue({ state: 'ok', data: { items: [], nextCursor: null } });
    const html = await render({ categoryId: 'cat-1' });
    expect(html).toContain('No published products were found in this category.');
    expect(html).toContain('Clear filters');
  });

  it('keeps the product catalog usable if category loading fails', async () => {
    mocks.categories.mockResolvedValue({ state: 'unavailable' });
    mocks.products.mockResolvedValue({ state: 'ok', data: { items: [], nextCursor: null } });
    const html = await render();
    expect(html).toContain('Categories are temporarily unavailable.');
    expect(html).toContain('No products found');
  });
});
