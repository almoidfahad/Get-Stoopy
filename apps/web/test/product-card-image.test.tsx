// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductCardImage } from '../src/components/product-card-image';
import { ProductCard } from '../src/components/product-card';

const image = { id: 'front', altText: 'Front view' };
afterEach(cleanup);

describe('catalog card images', () => {
  it('uses the same-origin image proxy and supplied alt text', () => {
    render(<ProductCardImage productId="product" productTitle="Item" image={image} />);
    const img = screen.getByRole('img', { name: 'Front view' });
    expect(img.getAttribute('src')).toBe('/api/catalog/products/product/images/front');
    expect(img.getAttribute('loading')).toBe('lazy');
  });
  it('shows an honest placeholder when no image was supplied', () => {
    render(<ProductCardImage productId="product" productTitle="Item" />);
    expect(screen.getByText('No image available')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
  it('shows a local error placeholder for a failed image, without a broken image', () => {
    render(<ProductCardImage productId="product" productTitle="Item" image={image} />);
    fireEvent.error(screen.getByRole('img', { name: 'Front view' }));
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Front view' })).toBeNull();
  });
  it('attempts the new image when the product or image changes', () => {
    const { rerender } = render(<ProductCardImage productId="first" productTitle="Item" image={image} />);
    fireEvent.error(screen.getByRole('img', { name: 'Front view' }));
    rerender(<ProductCardImage productId="second" productTitle="Other" image={{ id: 'back', altText: ' ' }} />);
    expect(screen.getByRole('img', { name: 'Other' }).getAttribute('src')).toBe('/api/catalog/products/second/images/back');
    expect(screen.queryByText('Image unavailable')).toBeNull();
  });
  it('keeps the product link usable and another card unaffected when one image fails', () => {
    const product = { id: 'one', title: 'First item', currency: 'BDT', variants: [], images: [image] };
    const other = { ...product, id: 'two', title: 'Second item', images: [{ id: 'back', altText: 'Back view' }] };
    render(<ul><ProductCard product={product as any} /><ProductCard product={other as any} /></ul>);
    fireEvent.error(screen.getByRole('img', { name: 'Front view' }));
    expect(screen.getByRole('link', { name: 'First item — out of stock' }).getAttribute('href')).toBe('/shop/one');
    expect(screen.getByRole('img', { name: 'Back view' })).toBeTruthy();
  });
  it('encodes path segments instead of accepting a remote URL', () => {
    render(<ProductCardImage productId="../product" productTitle="Item" image={{ id: 'x/y?z', altText: null }} />);
    expect(screen.getByRole('img', { name: 'Item' }).getAttribute('src')).toBe('/api/catalog/products/..%2Fproduct/images/x%2Fy%3Fz');
  });
});
