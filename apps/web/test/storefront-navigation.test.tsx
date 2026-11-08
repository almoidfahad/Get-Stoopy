// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StorefrontNavigation } from '../src/components/storefront-navigation';

afterEach(cleanup);
describe('storefront navigation', () => {
  it('uses a native disclosure that opens and closes on activation', () => {
    const { container } = render(<StorefrontNavigation />);
    const details = container.querySelector('details');
    const summary = container.querySelector('summary');
    expect(details?.hasAttribute('open')).toBe(false);
    expect(summary?.textContent).toContain('Menu');
    fireEvent.click(summary!);
    expect(details?.hasAttribute('open')).toBe(true);
    fireEvent.click(summary!);
    expect(details?.hasAttribute('open')).toBe(false);
  });
  it('exposes the same real destinations in the small-screen disclosure', () => {
    const { container } = render(<StorefrontNavigation />);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    const menu = container.querySelector('details')!;
    fireEvent.click(menu.querySelector('summary')!);
    for (const [label, href] of [['Home', '/'], ['Shop', '/shop'], ['My cart', '/cart'], ['My account', '/account']]) {
      expect(within(menu).getByRole('link', { name: label }).getAttribute('href')).toBe(href);
    }
    expect(nav.querySelector('details')).toBe(menu);
  });
  it('does not rely on JavaScript controls, invented features, or placeholder links', () => {
    const { container } = render(<StorefrontNavigation />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    const hrefs = Array.from(container.querySelectorAll('a')).map(link => link.getAttribute('href'));
    expect(new Set(hrefs)).toEqual(new Set(['/', '/shop', '/cart', '/account']));
  });
});
