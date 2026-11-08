import { describe, expect, it } from 'vitest';
import { isValidShopCursor, normalizeShopQuery } from '../src/lib/shop-query';
const id = '00000000-0000-4000-8000-000000000001';

describe('shop query normalization', () => {
  it('trims search and takes first repeated parameters just as the applied query does', () => {
    expect(normalizeShopQuery({ q: ['  chair  ', 'ignored'], categoryId: [id, 'ignored'], cursor: id })).toEqual({ q: 'chair', categoryId: id, cursor: id, issues: [] });
  });
  it('drops empty search without claiming an error', () => {
    expect(normalizeShopQuery({ q: '  ' })).toEqual({ q: undefined, categoryId: undefined, cursor: undefined, issues: [] });
  });
  it('accepts the maximum search length', () => {
    expect(normalizeShopQuery({ q: 'x'.repeat(120) })).toMatchObject({ q: 'x'.repeat(120), issues: [] });
  });
  it('reports dropped values and never returns them as applied filters', () => {
    expect(normalizeShopQuery({ q: 'x'.repeat(121), categoryId: 'bad', cursor: 'bad' })).toEqual({ q: undefined, categoryId: undefined, cursor: undefined, issues: ['search-too-long', 'invalid-category', 'invalid-cursor'] });
  });
  it('only permits next-page links with valid cursors', () => {
    expect(isValidShopCursor(id)).toBe(true);
    expect(isValidShopCursor('bad')).toBe(false);
    expect(isValidShopCursor({ toString: () => id })).toBe(false);
  });
});
