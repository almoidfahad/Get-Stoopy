import { describe, expect, it } from 'vitest';
import {
  buildShopQuery,
  formatMinorUnits,
  parseMinorUnits,
  summarizeVariantPrices,
  type PublicVariant,
} from '../src/index.js';

const variant = (over: Partial<PublicVariant> = {}): PublicVariant => ({
  id: 'v1',
  priceAmountMinor: '100000',
  compareAtAmountMinor: null,
  availableToPromise: 5,
  inStock: true,
  ...over,
});

describe('minor-unit parsing', () => {
  it('parses exact bigint values without a float round trip', () => {
    expect(parseMinorUnits('0')).toBe(0n);
    expect(parseMinorUnits('9007199254740993')).toBe(9007199254740993n);
  });

  it('rejects anything that is not a canonical non-negative integer string', () => {
    for (const bad of ['', '-1', '1.5', '01', '1e3', ' 1', 'abc', '9'.repeat(21)]) {
      expect(() => parseMinorUnits(bad)).toThrow('MINOR_UNITS_INVALID');
    }
  });
});

/**
 * Intl separates a currency code from the amount with U+00A0 so the figure never
 * wraps onto its own line. That is the desired rendering, so assertions normalise
 * it to a plain space instead of asserting an invisible codepoint.
 */
const display = (value: string | null): string | null =>
  value === null ? null : value.replace(/\u00a0/g, ' ');

describe('currency formatting', () => {
  it('uses the currency’s own decimal count, not a hardcoded 100', () => {
    expect(display(formatMinorUnits('100035', 'BDT', 'en-US'))).toBe('BDT 1,000.35');
    // JPY has no minor unit; 1000 must not become 10.00.
    expect(display(formatMinorUnits('1000', 'JPY', 'en-US'))).toBe('¥1,000');
  });

  it('keeps symbol placement correct in locales that suffix the currency', () => {
    expect(display(formatMinorUnits('100035', 'BDT', 'de-DE'))).toBe('1.000,35 BDT');
  });

  it('renders Bangla digits and symbol for bn-BD', () => {
    expect(display(formatMinorUnits('100035', 'BDT', 'bn-BD'))).toBe('১,০০০.৩৫৳');
  });

  it('does not lose precision above 2^53 minor units', () => {
    expect(display(formatMinorUnits('900719925474099335', 'BDT', 'en-US'))).toBe('BDT 9,007,199,254,740,993.35');
  });

  it('returns null for a malformed amount instead of showing a wrong price', () => {
    expect(formatMinorUnits('not-a-number', 'BDT', 'en-US')).toBeNull();
    expect(formatMinorUnits('-5', 'BDT', 'en-US')).toBeNull();
  });

  it('rejects an invalid currency code', () => {
    expect(() => formatMinorUnits('100', 'bdt', 'en-US')).toThrow('INVALID_CURRENCY');
  });
});

describe('variant price summary', () => {
  it('reports a single price when all orderable variants cost the same', () => {
    const summary = summarizeVariantPrices([variant(), variant({ id: 'v2' })]);
    expect(summary.lowestMinor).toBe(100000n);
    expect(summary.highestMinor).toBe(100000n);
    expect(summary.singlePrice).toBe(true);
    expect(summary.inStockCount).toBe(2);
  });

  it('reports a range when orderable prices differ', () => {
    const summary = summarizeVariantPrices([variant({ priceAmountMinor: '150000' }), variant({ priceAmountMinor: '90000' })]);
    expect(summary.lowestMinor).toBe(90000n);
    expect(summary.highestMinor).toBe(150000n);
    expect(summary.singlePrice).toBe(false);
  });

  it('excludes out-of-stock variants so a cheap unavailable option cannot set the advertised price', () => {
    const summary = summarizeVariantPrices([
      variant({ priceAmountMinor: '10000', inStock: false, availableToPromise: 0 }),
      variant({ priceAmountMinor: '120000' }),
    ]);
    expect(summary.lowestMinor).toBe(120000n);
    expect(summary.inStockCount).toBe(1);
  });

  it('treats zero available-to-promise as not orderable even if inStock is stale', () => {
    const summary = summarizeVariantPrices([variant({ availableToPromise: 0 })]);
    expect(summary.anyInStock).toBe(false);
    expect(summary.lowestMinor).toBeNull();
  });

  it('returns no price rather than zero when nothing is orderable', () => {
    const summary = summarizeVariantPrices([]);
    expect(summary.lowestMinor).toBeNull();
    expect(summary.highestMinor).toBeNull();
    expect(summary.anyInStock).toBe(false);
  });

  it('skips a malformed price without coercing it to zero', () => {
    const summary = summarizeVariantPrices([variant({ priceAmountMinor: 'oops' }), variant({ priceAmountMinor: '50000' })]);
    expect(summary.lowestMinor).toBe(50000n);
    expect(summary.inStockCount).toBe(2);
  });
});

describe('public catalog query building', () => {
  const uuid = '11111111-2222-3333-4444-555555555555';

  it('defaults the limit and trims the search term', () => {
    const params = buildShopQuery({ q:  '  rice  ' });
    expect(params.get('q')).toBe('rice');
    expect(params.get('limit')).toBe('20');
  });

  it('passes through valid category and cursor ids', () => {
    const params = buildShopQuery({ categoryId: uuid, cursor: uuid, limit: 50 });
    expect(params.get('categoryId')).toBe(uuid);
    expect(params.get('cursor')).toBe(uuid);
    expect(params.get('limit')).toBe('50');
  });

  it('drops values the API would reject instead of forwarding a 400', () => {
    const params = buildShopQuery({ q: 'x'.repeat(121), categoryId: 'nope', cursor: 'nope', limit: 500 });
    expect(params.has('q')).toBe(false);
    expect(params.has('categoryId')).toBe(false);
    expect(params.has('cursor')).toBe(false);
    expect(params.get('limit')).toBe('20');
  });

  it('never emits an injection-shaped category or cursor', () => {
    const params = buildShopQuery({ categoryId: "'; DROP TABLE--", cursor: '../../etc/passwd' });
    expect(params.has('categoryId')).toBe(false);
    expect(params.has('cursor')).toBe(false);
  });

  it('omits an empty or whitespace-only search', () => {
    expect(buildShopQuery({ q: '   ' }).has('q')).toBe(false);
    expect(buildShopQuery({}).has('q')).toBe(false);
  });
});