import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ product: vi.fn(), session: vi.fn(), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }) }));
vi.mock('@/lib/catalog', () => ({ fetchProduct: mocks.product, imageProxyUrl: (p: string, i: string) => `/api/catalog/${p}/${i}` }));
vi.mock('@/lib/cart', () => ({ hasSessionCookie: mocks.session }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: mocks.notFound }));
import ProductPage from '../src/app/shop/[id]/page';
import { ProductCard } from '../src/components/product-card';

const product = {
  id: 'product-1', title: 'Real item', brand: 'Brand', currency: 'BDT', description: 'Actual description',
  category: { id: 'category-1', name: 'Home', slug: 'home' }, store: { name: 'Real store' },
  images: [{ id: 'image-1', altText: 'Product view' }, { id: 'image-2', altText: 'Side view' }],
  variants: [{ id: 'v1', title: 'Small', priceAmountMinor: '1200', inStock: true, availableToPromise: 3 }, { id: 'v2', title: 'Large', priceAmountMinor: '1400', inStock: false, availableToPromise: 0 }],
};
async function render() { return renderToStaticMarkup(await ProductPage({ params: Promise.resolve({ id: 'product-1' }) })); }
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue(false); });

describe('product detail', () => {
  it('renders product information, real images, stock and sign-in state', async () => {
    mocks.product.mockResolvedValue({ state: 'ok', data: product });
    const html = await render();
    expect(html).toContain('Real item');
    expect(html).toContain('Real store');
    expect(html).toContain('Actual description');
    expect(html).toContain('/api/catalog/products/product-1/images/image-1');
    expect(html).toContain('View photo 2: Side view');
    expect(html).toContain('3 available');
    expect(html).toContain('Out of stock');
    expect(html).toContain('Sign in</a> to add this item');
    expect(html).toContain('payment and order confirmation are not yet available');
  });
  it('offers cart controls only for orderable options to a signed-in visitor', async () => {
    mocks.session.mockResolvedValue(true);
    mocks.product.mockResolvedValue({ state: 'ok', data: product });
    const html = await render();
    expect(html).toContain('Add to cart');
    expect(html).toContain('Quantity');
    expect(html).not.toContain('<option value="v2">');
  });
  it('handles out-of-stock and missing images without fabricated values', async () => {
    mocks.product.mockResolvedValue({ state: 'ok', data: { ...product, images: [], variants: [{ ...product.variants[1], inStock: false }] } });
    const html = await render();
    expect(html).toContain('No image available');
    expect(html).toContain('Nothing is currently available to order');
    expect(html).not.toContain('Add to cart');
  });
  it('does not mistake an invalid price for out of stock', async () => {
    const item = { ...product, variants: [{ ...product.variants[0], priceAmountMinor: 'invalid' }] };
    mocks.product.mockResolvedValue({ state: 'ok', data: item });
    expect(await render()).toContain('Price unavailable');
    const card = renderToStaticMarkup(<ProductCard product={item as any} />);
    expect(card).toContain('Price unavailable');
    expect(card).not.toContain('out of stock');
  });
  it.each([undefined, '', 'INVALID', 'bdt', null])('never guesses a currency when missing or invalid (%s)', async currency => {
    const item = { ...product, currency };
    mocks.session.mockResolvedValue(true);
    mocks.product.mockResolvedValue({ state: 'ok', data: item });
    const html = await render();
    const card = renderToStaticMarkup(<ProductCard product={item as any} />);
    expect(html).toContain('Price unavailable');
    expect(html).toContain('Pricing is unavailable');
    expect(html).not.toContain('Add to cart');
    expect(card).toContain('Price unavailable');
    expect(card).not.toContain('BDT');
  });
  it('only offers options with a valid positive price', async () => {
    const item = { ...product, variants: [product.variants[0], { ...product.variants[0], id: 'v3', title: 'Bad price', priceAmountMinor: '0' }] };
    mocks.session.mockResolvedValue(true);
    mocks.product.mockResolvedValue({ state: 'ok', data: item });
    const html = await render();
    expect(html).toContain('Price unavailable');
    expect(html).toContain('Add to cart');
    expect(html).toContain('12.00');
    expect(html).not.toContain('<option value="v3">');
  });
  it.each(['not-configured', 'unavailable'] as const)('renders the %s state', async state => {
    mocks.product.mockResolvedValue({ state });
    const html = await render();
    expect(html).toContain(state === 'not-configured' ? 'Market not configured' : 'Product unavailable');
    expect(html).toContain('Back to shop');
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it('keeps the not-found behavior', async () => {
    mocks.product.mockResolvedValue({ state: 'not-found' });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
