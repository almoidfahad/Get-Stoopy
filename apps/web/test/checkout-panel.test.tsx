import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { QuoteInput } from '@getstoopy/core/browser';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { CheckoutPanel } from '../src/components/checkout-panel';

const quote: QuoteInput = {
  quoteId: 'quote', cartId: 'cart', currency: 'BDT', state: 'RESERVED', destinationCityId: 'city',
  subtotalMinor: '100', version: 1, expiresAt: '2030-01-01T00:00:00Z', closedAt: null,
  deliveryFeeMinor: null, totalMinor: null, paymentStatus: 'NOT_IMPLEMENTED', groups: [], items: [],
};
const props = { cartVersion: 1, currency: 'BDT', cities: [{ cityId: 'city', name: 'City', code: 'C', storeCount: 1 }], truncated: false, reservationUnavailable: null };

describe('checkout panel reservation safeguards', () => {
  it('disables city selection immediately for a recovered reservation, before the clock effect runs', () => {
    const html = renderToStaticMarkup(<CheckoutPanel {...props} initialQuote={quote} />);
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(html).toContain('Reserve stock and get quote');
  });

  it('disables new reservations when required inputs are unavailable', () => {
    const html = renderToStaticMarkup(<CheckoutPanel {...props} initialQuote={quote} reservationUnavailable="Cities unavailable" />);
    expect(html).toContain('Cities unavailable');
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Reserve stock and get quote/);
  });
});
