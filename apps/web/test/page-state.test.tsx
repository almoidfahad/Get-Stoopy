// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NotFound from '../src/app/not-found';
import ProductNotFound from '../src/app/shop/[id]/not-found';
import ErrorPage from '../src/app/error';

afterEach(cleanup);

describe('branded page recovery', () => {
  it('offers navigation on a missing page without implying a product exists', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Explore the shop' }).getAttribute('href')).toBe('/shop');
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe('#main-content');
  });
  it('gives a product-specific missing state', () => {
    render(<ProductNotFound />);
    expect(screen.getByRole('heading', { name: 'Product not found' })).toBeTruthy();
    expect(screen.getByText(/This product could not be found/)).toBeTruthy();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Explore the shop' }).getAttribute('href')).toBe('/shop');
  });
  it('retries a failed route without displaying internal error details', () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('private internal exception'), { digest: 'private-digest' });
    render(<ErrorPage error={error} reset={reset} />);
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
    expect(screen.queryByText(/private internal exception|private-digest/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/');
  });
});
