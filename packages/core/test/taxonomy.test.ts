import { describe, expect, it } from 'vitest';
import { assertCategoryDepth, assertCategorySlug, assertCategoryTransition, assertProductImageAltText, assertProductImageSortOrder, assertProductImageTransition } from '../src/taxonomy';

describe('taxonomy and product image helpers', () => {
  it('allows only explicit category lifecycle transitions', () => {
    expect(() => assertCategoryTransition('DRAFT', 'ACTIVE')).not.toThrow();
    expect(() => assertCategoryTransition('ACTIVE', 'SUSPENDED')).not.toThrow();
    expect(() => assertCategoryTransition('SUSPENDED', 'ACTIVE')).not.toThrow();
    expect(() => assertCategoryTransition('DRAFT', 'SUSPENDED')).toThrow('CATEGORY_INVALID_TRANSITION');
  });
  it('validates category slug and bounded depth', () => {
    expect(() => assertCategorySlug('home-living')).not.toThrow();
    expect(() => assertCategorySlug('Home Living')).toThrow('CATEGORY_SLUG_INVALID');
    expect(() => assertCategorySlug('-bad')).toThrow('CATEGORY_SLUG_INVALID');
    expect(() => assertCategoryDepth(3)).not.toThrow();
    expect(() => assertCategoryDepth(4)).toThrow('CATEGORY_DEPTH_INVALID');
  });
  it('validates product image alt text, sort order and review transitions', () => {
    expect(() => assertProductImageAltText('Front view of a lamp')).not.toThrow();
    expect(() => assertProductImageAltText('no')).toThrow('PRODUCT_IMAGE_ALT_TEXT_INVALID');
    expect(() => assertProductImageSortOrder(0)).not.toThrow();
    expect(() => assertProductImageSortOrder(8)).toThrow('PRODUCT_IMAGE_SORT_ORDER_INVALID');
    expect(() => assertProductImageTransition('PENDING_REVIEW', 'APPROVED')).not.toThrow();
    expect(() => assertProductImageTransition('APPROVED', 'PENDING_REVIEW')).toThrow('PRODUCT_IMAGE_INVALID_TRANSITION');
  });
});
