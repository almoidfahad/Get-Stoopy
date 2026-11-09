// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.search }));
import NotFound from '../src/app/not-found';
import ProductNotFound from '../src/app/shop/[id]/not-found';
import ErrorPage from '../src/app/error';

afterEach(() => { cleanup(); mocks.search = new URLSearchParams(); });

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
  it('returns to valid filtered results for a missing product', () => {
    const category = '11111111-1111-4111-8111-111111111111';
    const cursor = '22222222-2222-4222-8222-222222222222';
    mocks.search = new URLSearchParams({ q: 'chair & table', categoryId: category, cursor, returnTo: 'https://evil.example' });
    render(<ProductNotFound />);
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Back to results' }).getAttribute('href'))
      .toBe(`/shop?q=chair+%26+table&categoryId=${category}&cursor=${cursor}`);
    expect(within(screen.getByRole('main')).queryByRole('link', { name: 'Explore the shop' })).toBeNull();
  });
  it('falls back to the shop for invalid context and ignores external return destinations', () => {
    mocks.search = new URLSearchParams({ q: 'x'.repeat(121), categoryId: '//evil.example', cursor: 'invalid', returnTo: 'https://evil.example' });
    render(<ProductNotFound />);
    const link = within(screen.getByRole('main')).getByRole('link', { name: 'Explore the shop' });
    expect(link.getAttribute('href')).toBe('/shop');
  });
  it('uses the first value of repeated filters, like the shop page', () => {
    mocks.search = new URLSearchParams('q=chair&q=table&cursor=bad');
    render(<ProductNotFound />);
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Back to results' }).getAttribute('href')).toBe('/shop?q=chair');
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
