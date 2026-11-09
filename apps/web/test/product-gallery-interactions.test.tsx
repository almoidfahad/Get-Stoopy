// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductGallery } from '../src/components/product-gallery';
import { imageProxyUrl } from '../src/lib/catalog-image';

const images = [{ id: 'first', altText: 'Front view' }, { id: 'second', altText: 'Side view' }, { id: 'third', altText: null }];
afterEach(cleanup);

describe('product photo gallery', () => {
  it('switches photos, labels the selection and uses same-origin paths', () => {
    render(<ProductGallery productId="product" productTitle="Item" images={images} />);
    expect(screen.getByRole('img', { name: 'Front view' }).getAttribute('src')).toBe('/api/catalog/products/product/images/first');
    expect(screen.getByRole('button', { name: 'View photo 1: Front view' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'View photo 2: Side view' }));
    expect(screen.getByRole('img', { name: 'Side view' }).getAttribute('src')).toBe('/api/catalog/products/product/images/second');
    expect(screen.getByRole('button', { name: 'View photo 2: Side view' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Photo 2 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View photo 3: Item' }));
    expect(screen.getByRole('img', { name: 'Item' })).toBeTruthy();
  });
  it('offers every supplied photo, including the eighth', () => {
    const all = Array.from({ length: 8 }, (_, index) => ({ id: `id-${index}`, altText: `Photo ${index + 1}` }));
    render(<ProductGallery productId="product" productTitle="Item" images={all} />);
    fireEvent.click(screen.getByRole('button', { name: 'View photo 8: Photo 8' }));
    expect(screen.getByText('Photo 8 of 8')).toBeTruthy();
  });
  it('honestly handles missing or failed images and allows another photo to be selected', () => {
    const { rerender } = render(<ProductGallery productId="product" productTitle="Item" images={[]} />);
    expect(screen.getByText('No image available')).toBeTruthy();
    rerender(<ProductGallery productId="product" productTitle="Item" images={images} />);
    fireEvent.error(screen.getByRole('img', { name: 'Front view' }));
    expect(screen.getByRole('status').textContent).toContain('Photo could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'View photo 2: Side view' }));
    expect(screen.getByRole('img', { name: 'Side view' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('recovers when the image has already failed before hydration effects run', () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    const width = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);
    try {
      render(<ProductGallery productId="product" productTitle="Item" images={images} />);
      expect(screen.getByRole('status').textContent).toBe('Photo could not be loaded.');
      expect(screen.getByRole('button', { name: 'Try photo again' })).toBeTruthy();
    } finally {
      complete.mockRestore();
      width.mockRestore();
    }
  });
  it('retries a failed photo without losing keyboard focus or resetting other photos', () => {
    render(<ProductGallery productId="product" productTitle="Item" images={images} />);
    fireEvent.error(screen.getByRole('img', { name: 'Front view' }));
    const retry = screen.getByRole('button', { name: 'Try photo again' });
    retry.focus();
    fireEvent.click(retry);
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole('status').textContent).toBe('Loading photo again…');
    const photo = screen.getByRole('img', { name: 'Front view' });
    expect(photo.getAttribute('src')).toBe('/api/catalog/products/product/images/first?retry=1');
    fireEvent.error(photo);
    expect(screen.getByRole('status').textContent).toBe('Photo could not be loaded.');
    fireEvent.click(retry);
    const secondAttempt = screen.getByRole('img', { name: 'Front view' });
    expect(secondAttempt.getAttribute('src')).toContain('?retry=2');
    fireEvent.load(secondAttempt);
    expect(screen.getByRole('status').textContent).toBe('Photo loaded.');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reload photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'View photo 2: Side view' }));
    expect(screen.getByRole('img', { name: 'Side view' }).getAttribute('src')).toBe('/api/catalog/products/product/images/second');
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('resets photo selection and failures when navigating to another product', () => {
    const { rerender } = render(<ProductGallery productId="first-product" productTitle="First" images={images} />);
    fireEvent.click(screen.getByRole('button', { name: 'View photo 2: Side view' }));
    fireEvent.error(screen.getByRole('img', { name: 'Side view' }));
    rerender(<ProductGallery productId="second-product" productTitle="Second" images={images} />);
    expect(screen.getByRole('img', { name: 'Front view' }).getAttribute('src')).toBe('/api/catalog/products/second-product/images/first');
    expect(screen.getByRole('button', { name: 'View photo 1: Front view' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View photo 2: Side view' }));
    expect(screen.getByRole('img', { name: 'Side view' })).toBeTruthy();
  });
  it('does not hide a full image when only its thumbnail fails', () => {
    render(<ProductGallery productId="product" productTitle="Item" images={images} />);
    const button = screen.getByRole('button', { name: 'View photo 2: Side view' });
    const thumbnail = button.querySelector('img');
    expect(thumbnail).toBeTruthy();
    fireEvent.error(thumbnail!);
    expect(button.textContent).toContain('Unavailable');
    fireEvent.click(button);
    expect(screen.getByRole('img', { name: 'Side view' })).toBeTruthy();
  });
  it('falls back to an actual remaining image when selected data changes', () => {
    const { rerender } = render(<ProductGallery productId="product" productTitle="Item" images={images} />);
    fireEvent.click(screen.getByRole('button', { name: 'View photo 2: Side view' }));
    rerender(<ProductGallery productId="product" productTitle="Item" images={[images[0]!, images[2]!]} />);
    expect(screen.getByRole('img', { name: 'Front view' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View photo 1: Front view' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('keeps image paths relative and encodes untrusted path segments', () => {
    const url = imageProxyUrl('../other?x', 'image/../../x');
    expect(url).toBe('/api/catalog/products/..%2Fother%3Fx/images/image%2F..%2F..%2Fx');
  });
});
