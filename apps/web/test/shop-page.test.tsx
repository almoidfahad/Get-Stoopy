import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ products: vi.fn(), categories: vi.fn() }));
vi.mock('@/lib/catalog', () => ({ fetchProducts: mocks.products, fetchCategories: mocks.categories, imageProxyUrl: () => '/image' }));
import ShopPage from '../src/app/shop/page';

const category = { id: '00000000-0000-4000-8000-000000000001', name: 'Home & Living', slug: 'home', parentId: null, description: null, sortOrder: 0 };
async function render(params: Record<string, string | string[]> = {}) {
  return renderToStaticMarkup(await ShopPage({ searchParams: Promise.resolve(params) }));
}
beforeEach(() => { vi.resetAllMocks(); mocks.categories.mockResolvedValue({ state: 'ok', data: [category] }); });

describe('shop page', () => {
  it('uses real search and category data, preserving filters in pagination', async () => {
    mocks.products.mockResolvedValue({ state: 'ok', data: { items: [{ id: 'p1', title: 'A real product', currency: 'BDT', variants: [], images: [] }], nextCursor: '00000000-0000-4000-8000-000000000002' } });
    const html = await render({ q: 'chair & table', categoryId: category.id });
    expect(mocks.products).toHaveBeenCalledWith({ q: 'chair & table', categoryId: category.id, cursor: undefined });
    expect(html).toContain('A real product');
    expect(html).toContain('Home &amp; Living');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('name="categoryId" value="00000000-0000-4000-8000-000000000001"');
    expect(html).toContain('q=chair+%26+table&amp;categoryId=00000000-0000-4000-8000-000000000001&amp;cursor=00000000-0000-4000-8000-000000000002');
    expect(html).toContain('rel="next"');
  });

  it('keeps the applied search, category and current page on product links', async () => {
    mocks.products.mockResolvedValue({ state: 'ok', data: { items: [{ id: 'p1', title: 'Item', currency: 'BDT', variants: [], images: [] }], nextCursor: null } });
    const cursor = '00000000-0000-4000-8000-000000000003';
    const html = await render({ q: 'chair & table', categoryId: category.id, cursor, ignored: 'https://evil.example' });
    expect(html).toContain(`/shop/p1?q=chair+%26+table&amp;categoryId=${category.id}&amp;cursor=${cursor}`);
    expect(html).not.toContain('evil.example');
  });

  it('offers a mobile category disclosure and individually removable applied filters', async () => {
    mocks.products.mockResolvedValue({ state: 'ok', data: { items: [], nextCursor: null } });
    const html = await render({ q: 'chair & table', categoryId: category.id, cursor: '00000000-0000-4000-8000-000000000003' });
    expect(html).toContain('<details class="group mt-6');
    expect(html).toContain('All categories');
    expect(html).toContain('aria-label="Remove search filter"');
    expect(html).toMatch(/<a aria-label="Remove search filter"[^>]*href="\/shop\?categoryId=00000000-0000-4000-8000-000000000001"/);
    expect(html).toMatch(/<a aria-label="Remove category filter"[^>]*href="\/shop\?q=chair\+%26\+table"/);
  });
  it('retains a valid selected category when its name cannot be loaded', async () => {
    mocks.categories.mockResolvedValue({ state: 'unavailable' });
    mocks.products.mockResolvedValue({ state: 'ok', data: { items: [], nextCursor: null } });
    const html = await render({ categoryId: category.id });
    expect(html).toContain('Selected category');
    expect(html).toContain('Categories are temporarily unavailable');
    expect(html).toContain('aria-label="Remove category filter"');
    expect(mocks.products).toHaveBeenCalledWith({ q: undefined, categoryId: category.id, cursor: undefined });
  });
  it('warns when invalid URL filters are dropped and only shows applied filters', async () => {
    mocks.products.mockResolvedValue({ state: 'ok', data: { items: [], nextCursor: null } });
    const html = await render({ q: 'x'.repeat(121), categoryId: 'invalid', cursor: 'invalid' });
    expect(mocks.products).toHaveBeenCalledWith({ q: undefined, categoryId: undefined, cursor: undefined });
    expect(html).toContain('Some filters were not applied');
    expect(html).toContain('Search terms must be 120 characters or fewer');
    expect(html).toContain('The category link was invalid');
    expect(html).toContain('The page link was invalid');
    expect(html).not.toContain('Nothing matched');
    expect(html).not.toContain('Selected category');
  });
  it('preserves applied filters when returning to the first page', async () => {
    mocks.products.mockResolvedValue({ state: 'ok', data: { items: [{ id: 'p1', title: 'Item', currency: 'BDT', variants: [], images: [] }], nextCursor: null } });
    const html = await render({ q: '  chair  ', categoryId: category.id, cursor: '00000000-0000-4000-8000-000000000003' });
    expect(mocks.products).toHaveBeenCalledWith({ q: 'chair', categoryId: category.id, cursor: '00000000-0000-4000-8000-000000000003' });
    expect(html).toContain('Showing 1 product on this page.');
    expect(html).toContain('q=chair&amp;categoryId=00000000-0000-4000-8000-000000000001');
    expect(html).toContain('First page');
  });
  it('does not link to an invalid next cursor', async () => {
    mocks.products.mockResolvedValue({ state: 'ok', data: { items: [{ id: 'p1', title: 'Item', currency: 'BDT', variants: [], images: [] }], nextCursor: 'bad-cursor' } });
    const html = await render();
    expect(html).toContain('The next page is temporarily unavailable');
    expect(html).not.toContain('rel="next"');
  });
  it('offers the first page with filters intact after an empty later page', async () => {
    mocks.products.mockResolvedValue({ state: 'ok', data: { items: [], nextCursor: null } });
    const html = await render({ q: 'chair', categoryId: category.id, cursor: '00000000-0000-4000-8000-000000000003' });
    expect(html).toContain('Back to first page');
    expect(html).toContain('There are no products on this page.');
    expect(html).not.toContain('Nothing matched');
    expect(html).toContain('q=chair&amp;categoryId=00000000-0000-4000-8000-000000000001');
  });
  it.each(['not-configured', 'unavailable'] as const)('shows %s honestly without demo products', async state => {
    mocks.products.mockResolvedValue({ state });
    const html = await render();
    expect(html).toContain(state === 'not-configured' ? 'Our shop is getting ready' : 'Catalog unavailable');
    expect(html).not.toContain('A real product');
  });

  it('offers a real reload preserving applied filters when the catalog is unavailable', async () => {
    mocks.products.mockResolvedValue({ state: 'unavailable' });
    const html = await render({ q: 'chair', categoryId: category.id, cursor: '00000000-0000-4000-8000-000000000003' });
    expect(html).toContain('Try again');
    expect(html).toContain('q=chair&amp;categoryId=00000000-0000-4000-8000-000000000001&amp;cursor=00000000-0000-4000-8000-000000000003');
  });

  it('explains an empty category and allows clearing filters', async () => {
    mocks.products.mockResolvedValue({ state: 'ok', data: { items: [], nextCursor: null } });
    const html = await render({ categoryId: category.id });
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
