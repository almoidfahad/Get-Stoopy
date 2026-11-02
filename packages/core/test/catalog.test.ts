import { describe, expect, it } from 'vitest';
import { assertProductDraftTransition, assertStoreTransition, assertVariantPrice, parsePriceMinor } from '../src/catalog';

describe('store and draft catalog helpers', () => {
  it('allows only explicit store lifecycle transitions', () => {
    expect(() => assertStoreTransition('DRAFT', 'ACTIVE')).not.toThrow();
    expect(() => assertStoreTransition('ACTIVE', 'SUSPENDED')).not.toThrow();
    expect(() => assertStoreTransition('SUSPENDED', 'ACTIVE')).not.toThrow();
    expect(() => assertStoreTransition('DRAFT', 'SUSPENDED')).toThrow('STORE_INVALID_TRANSITION');
  });
  it('keeps publication disabled in the draft-only slice', () => {
    expect(() => assertProductDraftTransition('DRAFT', 'ARCHIVED')).not.toThrow();
    expect(() => assertProductDraftTransition('DRAFT', 'PUBLISHED')).toThrow('PRODUCT_PUBLICATION_NOT_ENABLED');
    expect(() => assertProductDraftTransition('ARCHIVED', 'DRAFT')).toThrow('PRODUCT_INVALID_TRANSITION');
  });
  it('parses positive safe minor-unit prices', () => {
    expect(parsePriceMinor('1250')).toBe(1250n);
    expect(() => parsePriceMinor('0')).toThrow('PRICE_MINOR_INVALID');
    expect(() => parsePriceMinor('-1')).toThrow('PRICE_MINOR_INVALID');
    expect(() => parsePriceMinor('1.5')).toThrow('PRICE_MINOR_INVALID');
    expect(() => parsePriceMinor('9007199254740992')).toThrow('PRICE_MINOR_INVALID');
  });
  it('enforces currency and compare-at price rules', () => {
    expect(() => assertVariantPrice(1000n, 1200n, 'BDT', 'BDT')).not.toThrow();
    expect(() => assertVariantPrice(1000n, null, 'BDT', 'BDT')).not.toThrow();
    expect(() => assertVariantPrice(1000n, null, 'USD', 'BDT')).toThrow('CURRENCY_MISMATCH');
    expect(() => assertVariantPrice(1000n, 999n, 'BDT', 'BDT')).toThrow('COMPARE_AT_PRICE_INVALID');
    expect(() => assertVariantPrice(0n, null, 'BDT', 'BDT')).toThrow('PRICE_MINOR_INVALID');
  });
});
