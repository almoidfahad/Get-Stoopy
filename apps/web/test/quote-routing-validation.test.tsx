import { describe, expect, it } from 'vitest';
import { isQuoteInput } from '../src/lib/quote-validation';

const quote = {
  quoteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cartId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  destinationCityId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  state: 'RESERVED', version: 1, currency: 'BDT', subtotalMinor: '0',
  expiresAt: '2100-01-01T00:00:00Z', closedAt: null,
  deliveryFeeMinor: null, totalMinor: null, paymentStatus: 'NOT_IMPLEMENTED', items: [], groups: [],
};
describe('quote routing identifier validation', () => {
  it('accepts valid UUIDs in either case', () => {
    expect(isQuoteInput(quote)).toBe(true);
    expect(isQuoteInput({ ...quote, quoteId: quote.quoteId.toUpperCase(), cartId: quote.cartId.toUpperCase(), destinationCityId: quote.destinationCityId.toUpperCase() })).toBe(true);
  });
  it.each(['quoteId', 'cartId', 'destinationCityId'] as const)('rejects malformed %s values', field => {
    for (const value of [null, 1, {}, '', ' ', 'bad-id', '../quotes', `${quote[field]}\n`, quote[field].replace(/-/g, '')]) {
      expect(isQuoteInput({ ...quote, [field]: value }), `${field}: ${String(value)}`).toBe(false);
    }
  });
});
