import { describe, expect, it } from 'vitest';
import {
  QUOTE_ISSUE_MESSAGES,
  QUOTE_RELEASE_REASON,
  parseQuoteCreate,
  parseQuoteRelease,
  quoteErrorMessage,
  summarizeQuote,
  type QuoteInput,
  type QuoteItemInput,
} from '../src/index.js';

const NOW = new Date('2026-11-04T10:00:00.000Z');

const item = (over: Partial<QuoteItemInput> = {}): QuoteItemInput => ({
  itemId: 'i1',
  groupId: 'g1',
  variantId: 'v1',
  productTitle: 'Rice 5kg',
  quantity: 2,
  unitPriceMinor: '50000',
  lineTotalMinor: '100000',
  currency: 'BDT',
  ...over,
});

const quote = (over: Partial<QuoteInput> = {}): QuoteInput => ({
  quoteId: 'q1',
  cartId: 'c1',
  currency: 'BDT',
  state: 'RESERVED',
  destinationCityId: '11111111-1111-4111-8111-111111111111',
  subtotalMinor: '100000',
  version: 1,
  expiresAt: '2026-11-04T10:10:00.000Z',
  closedAt: null,
  deliveryFeeMinor: null,
  totalMinor: null,
  paymentStatus: 'NOT_IMPLEMENTED',
  groups: [{ groupId: 'g1', storeId: 's1', subtotalMinor: '100000', currency: 'BDT' }],
  items: [item()],
  ...over,
});

describe('quote summary', () => {
  it('re-derives the subtotal in minor units and counts stores, lines and units', () => {
    const summary = summarizeQuote(
      quote({
        subtotalMinor: '125000',
        groups: [{ groupId: 'g1', storeId: 's1', subtotalMinor: '125000', currency: 'BDT' }],
        items: [item(), item({ itemId: 'i2', variantId: 'v2', quantity: 1, unitPriceMinor: '25000', lineTotalMinor: '25000' })],
      }),
      NOW,
    );
    expect(summary.subtotalMinor).toBe(125000n);
    expect(summary.lineCount).toBe(2);
    expect(summary.unitCount).toBe(3);
    expect(summary.storeCount).toBe(1);
    expect(summary.issues).toEqual([]);
  });

  it('keeps precision above 2^53 minor units', () => {
    const big = '9007199254740993';
    const summary = summarizeQuote(
      quote({
        subtotalMinor: big,
        groups: [{ groupId: 'g1', storeId: 's1', subtotalMinor: big, currency: 'BDT' }],
        items: [item({ quantity: 1, unitPriceMinor: big, lineTotalMinor: big })],
      }),
      NOW,
    );
    expect(summary.subtotalMinor).toBe(9007199254740993n);
  });

  it('never claims delivery or payment is implemented while the API says null', () => {
    const summary = summarizeQuote(quote(), NOW);
    expect(summary.totalsImplemented).toBe(false);
    expect(summary.paymentImplemented).toBe(false);
  });

  it.each([
    { deliveryFeeMinor: '4000', totalMinor: '104000' },
    { deliveryFeeMinor: '4000' },
    { totalMinor: '100000' },
    { deliveryFeeMinor: 'nonsense', totalMinor: '-1' },
    { paymentStatus: 'READY' },
    { paymentStatus: '' },
  ])('fails closed on unsupported delivery, total or payment fields: %j', fields => {
    const summary = summarizeQuote(quote(fields), NOW);
    expect(summary.totalsImplemented).toBe(false);
    expect(summary.paymentImplemented).toBe(false);
    expect(summary.issues).toContainEqual({ kind: 'unsupported-checkout-fields', itemId: null });
    expect(summary.canRelease).toBe(true);
  });

  it('counts down to expiry and never returns a negative remainder', () => {
    expect(summarizeQuote(quote(), NOW).secondsRemaining).toBe(600);
    const past = summarizeQuote(quote({ expiresAt: '2026-11-04T09:59:00.000Z' }), NOW);
    expect(past.secondsRemaining).toBe(0);
    expect(past.status).toBe('expired');
  });

  it('treats a RESERVED row past its deadline as expired but still releasable', () => {
    const summary = summarizeQuote(quote({ expiresAt: '2026-11-04T09:00:00.000Z' }), NOW);
    expect(summary.status).toBe('expired');
    // Releasing returns stock to other buyers even before the sweeper runs.
    expect(summary.canRelease).toBe(true);
  });

  it('does not claim a countdown when a reserved quote has no valid expiry', () => {
    const summary = summarizeQuote(quote({ expiresAt: 'invalid' }), NOW);
    expect(summary.status).toBe('unknown');
    expect(summary.canRelease).toBe(true);
  });

  it('blocks a malformed quote, item or group currency', () => {
    for (const input of [quote({ currency: '' }), quote({ items: [item({ currency: 'bdt' })] }), quote({ groups: [{ groupId: 'g1', storeId: 's1', subtotalMinor: '100000', currency: 'BD' }] })]) {
      const summary = summarizeQuote(input, NOW);
      expect(summary.subtotalMinor).toBeNull();
      expect(summary.issues.map(i => i.kind)).toContain('currency-invalid');
    }
  });

  it('maps closed states and stops offering release for them', () => {
    expect(summarizeQuote(quote({ state: 'RELEASED' }), NOW).status).toBe('released');
    expect(summarizeQuote(quote({ state: 'CONSUMED' }), NOW).status).toBe('consumed');
    expect(summarizeQuote(quote({ state: 'EXPIRED' }), NOW).canRelease).toBe(false);
    expect(summarizeQuote(quote({ state: 'SOMETHING_NEW' }), NOW).status).toBe('unknown');
  });

  it('flags a line total that no longer matches unit price × quantity', () => {
    const summary = summarizeQuote(quote({ items: [item({ lineTotalMinor: '99999' })] }), NOW);
    expect(summary.issues.map(i => i.kind)).toContain('line-total-mismatch');
  });

  it('flags a quote subtotal that disagrees with its items', () => {
    const summary = summarizeQuote(quote({ subtotalMinor: '1' }), NOW);
    expect(summary.issues.map(i => i.kind)).toContain('subtotal-mismatch');
  });

  it('flags a store subtotal that disagrees with its items', () => {
    const summary = summarizeQuote(
      quote({ groups: [{ groupId: 'g1', storeId: 's1', subtotalMinor: '1', currency: 'BDT' }] }),
      NOW,
    );
    expect(summary.issues.map(i => i.kind)).toContain('group-subtotal-mismatch');
  });

  it('refuses to sum mixed currencies', () => {
    const summary = summarizeQuote(quote({ items: [item({ currency: 'USD' })] }), NOW);
    expect(summary.currency).toBeNull();
    expect(summary.subtotalMinor).toBeNull();
    expect(summary.issues.map(i => i.kind)).toContain('currency-mismatch');
  });

  it('withholds the subtotal when a price cannot be parsed', () => {
    const summary = summarizeQuote(quote({ items: [item({ unitPriceMinor: 'not-a-number' })] }), NOW);
    expect(summary.subtotalMinor).toBeNull();
    expect(summary.issues.map(i => i.kind)).toContain('price-invalid');
  });

  it('returns no subtotal for an empty quote', () => {
    const summary = summarizeQuote(quote({ items: [], groups: [], subtotalMinor: '0' }), NOW);
    expect(summary.subtotalMinor).toBeNull();
    expect(summary.lineCount).toBe(0);
  });

  it('accepts multiple complete groups and case-equivalent identifiers', () => {
    const summary = summarizeQuote(quote({
      subtotalMinor: '150000',
      groups: [{ groupId: 'G1', storeId: 's1', subtotalMinor: '100000', currency: 'BDT' }, { groupId: 'g2', storeId: 's2', subtotalMinor: '50000', currency: 'BDT' }],
      items: [item(), item({ itemId: 'i2', variantId: 'v2', groupId: 'G2', quantity: 1, lineTotalMinor: '50000' })],
    }), NOW);
    expect(summary.issues).toEqual([]);
    expect(summary.subtotalMinor).toBe(150000n);
    expect(summary.storeCount).toBe(2);
  });

  it.each([
    ['missing groups', quote({ groups: [] })],
    ['missing item group', quote({ items: [item({ groupId: 'missing' })] })],
    ['empty quote', quote({ items: [], groups: [], subtotalMinor: '0' })],
    ['unused zero-price group', quote({ groups: [{ groupId: 'g1', storeId: 's1', subtotalMinor: '100000', currency: 'BDT' }, { groupId: 'g2', storeId: 's2', subtotalMinor: '0', currency: 'BDT' }] })],
    ['duplicate group', quote({ groups: [{ groupId: 'g1', storeId: 's1', subtotalMinor: '100000', currency: 'BDT' }, { groupId: 'G1', storeId: 's2', subtotalMinor: '100000', currency: 'BDT' }] })],
    ['duplicate store', quote({ groups: [{ groupId: 'g1', storeId: 's1', subtotalMinor: '100000', currency: 'BDT' }, { groupId: 'g2', storeId: 'S1', subtotalMinor: '0', currency: 'BDT' }], items: [item(), item({ itemId: 'i2', variantId: 'v2', groupId: 'g2', unitPriceMinor: '0', lineTotalMinor: '0' })] })],
    ['duplicate item', quote({ subtotalMinor: '200000', groups: [{ groupId: 'g1', storeId: 's1', subtotalMinor: '200000', currency: 'BDT' }], items: [item(), item({ itemId: 'I1', variantId: 'v2' })] })],
    ['duplicate variant', quote({ subtotalMinor: '200000', groups: [{ groupId: 'g1', storeId: 's1', subtotalMinor: '200000', currency: 'BDT' }], items: [item(), item({ itemId: 'i2', variantId: 'V1' })] })],
    ['blank group id', quote({ groups: [{ groupId: ' ', storeId: 's1', subtotalMinor: '100000', currency: 'BDT' }], items: [item({ groupId: ' ' })] })],
    ['blank store id', quote({ groups: [{ groupId: 'g1', storeId: '', subtotalMinor: '100000', currency: 'BDT' }] })],
    ['blank item id', quote({ items: [item({ itemId: '' })] })],
    ['blank variant id', quote({ items: [item({ variantId: '' })] })],
  ])('withholds totals but keeps release available for %s', (_label, badQuote) => {
    const summary = summarizeQuote(badQuote, NOW);
    expect(summary.issues.map(i => i.kind)).toContain('quote-structure-invalid');
    expect(summary.subtotalMinor).toBeNull();
    expect(summary.canRelease).toBe(true);
  });

  it('has copy for every issue kind it can raise', () => {
    const kinds = ['price-invalid', 'line-total-mismatch', 'group-subtotal-mismatch', 'subtotal-mismatch', 'currency-mismatch', 'currency-invalid', 'quote-structure-invalid'] as const;
    for (const kind of kinds) expect(QUOTE_ISSUE_MESSAGES[kind].length).toBeGreaterThan(10);
  });
});

describe('quote request parsing', () => {
  const body = {
    destinationCityId: '11111111-1111-4111-8111-111111111111',
    expectedVersion: 3,
    attemptId: '22222222-2222-4222-8222-222222222222',
  };

  it('derives a namespaced command key so a retry cannot double-reserve', () => {
    const result = parseQuoteCreate(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.commandKey).toBe('web-22222222-2222-4222-8222-222222222222');
      expect(result.value.expectedVersion).toBe(3);
    }
  });

  it('produces a command key the API regex accepts', () => {
    const result = parseQuoteCreate(body);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.commandKey).toMatch(/^[A-Za-z0-9:_-]{8,128}$/);
  });

  it('normalises uuid case so the same attempt maps to the same key', () => {
    const upper = parseQuoteCreate({ ...body, attemptId: body.attemptId.toUpperCase() });
    const lower = parseQuoteCreate(body);
    expect(upper.ok && lower.ok && upper.value.commandKey === lower.value.commandKey).toBe(true);
  });

  it('rejects a missing or malformed destination', () => {
    for (const destinationCityId of [undefined, '', 'dhaka', 42]) {
      const result = parseQuoteCreate({ ...body, destinationCityId });
      expect(result).toEqual({ ok: false, code: 'DESTINATION_INVALID' });
    }
  });

  it('rejects a missing, fractional or zero version', () => {
    for (const expectedVersion of [undefined, 0, -1, 1.5, '3']) {
      expect(parseQuoteCreate({ ...body, expectedVersion })).toEqual({ ok: false, code: 'VERSION_INVALID' });
    }
  });

  it('rejects a missing or malformed attempt id', () => {
    for (const attemptId of [undefined, 'abc', '']) {
      expect(parseQuoteCreate({ ...body, attemptId })).toEqual({ ok: false, code: 'ATTEMPT_ID_INVALID' });
    }
  });

  it('rejects a non-object body', () => {
    expect(parseQuoteCreate(null)).toEqual({ ok: false, code: 'BODY_INVALID' });
    expect(parseQuoteCreate('x')).toEqual({ ok: false, code: 'BODY_INVALID' });
  });

  it('ignores a client-supplied release reason and uses the audited one', () => {
    const result = parseQuoteRelease({ version: 2, reason: 'erase the audit trail' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reason).toBe(QUOTE_RELEASE_REASON);
      expect(result.value.version).toBe(2);
    }
  });

  it('keeps the release reason inside the API length bounds', () => {
    expect(QUOTE_RELEASE_REASON.length).toBeGreaterThanOrEqual(8);
    expect(QUOTE_RELEASE_REASON.length).toBeLessThanOrEqual(512);
  });

  it('rejects an invalid release version', () => {
    expect(parseQuoteRelease({ version: 0 })).toEqual({ ok: false, code: 'VERSION_INVALID' });
    expect(parseQuoteRelease({})).toEqual({ ok: false, code: 'VERSION_INVALID' });
    expect(parseQuoteRelease(null)).toEqual({ ok: false, code: 'BODY_INVALID' });
  });
});

describe('quote error copy', () => {
  it('explains an unserviceable destination without blaming the buyer', () => {
    expect(quoteErrorMessage('CHECKOUT_DESTINATION_NOT_SERVICEABLE', 409)).toContain('One or more stores');
  });

  it('falls back by status class for unknown codes', () => {
    expect(quoteErrorMessage('SOMETHING_NEW', 502)).toContain('unavailable');
    expect(quoteErrorMessage(undefined, 400)).toContain('could not be completed');
  });
});
