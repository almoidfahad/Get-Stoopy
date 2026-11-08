// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QuoteInput } from '@getstoopy/core/browser';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { CheckoutPanel } from '../src/components/checkout-panel';

const cities = [{ cityId: 'city-a', name: 'City A', code: 'A', storeCount: 1 }, { cityId: 'city-b', name: 'City B', code: 'B', storeCount: 2 }];
const quote: QuoteInput = { quoteId: 'quote', cartId: 'cart', currency: 'BDT', state: 'RESERVED', destinationCityId: 'city-b', subtotalMinor: '0', version: 1, expiresAt: '2100-01-01T00:00:00Z', closedAt: null, deliveryFeeMinor: null, totalMinor: null, paymentStatus: 'NOT_IMPLEMENTED', groups: [], items: [] };
const props = { cartVersion: 1, currency: 'BDT', cities, truncated: false, reservationUnavailable: null };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('checkout destination and quote recovery interactions', () => {
  it('shows a recovered reservation’s actual city and prevents changing it', () => {
    render(<CheckoutPanel {...props} initialQuote={quote} />);
    const select = screen.getByLabelText('City') as HTMLSelectElement;
    expect(select.value).toBe('city-b');
    expect(select.disabled).toBe(true);
    expect(screen.getByText('City B')).toBeTruthy();
    expect(screen.getByText(/Recipient details and delivery addresses are not collected yet/)).toBeTruthy();
  });
  it('does not substitute another city if the quote city is missing from the list', () => {
    render(<CheckoutPanel {...props} cities={[cities[0]!]} initialQuote={quote} />);
    const select = screen.getByLabelText('City') as HTMLSelectElement;
    expect(select.value).toBe('city-b');
    expect(select.selectedOptions[0]?.textContent).toBe('City details unavailable for this quote');
    expect(screen.getByText('City details unavailable')).toBeTruthy();
  });
  it('adopts a recovered quote after refresh and ignores older versions of it', () => {
    const { rerender } = render(<CheckoutPanel {...props} initialQuote={null} />);
    rerender(<CheckoutPanel {...props} initialQuote={{ ...quote, version: 2 }} />);
    expect((screen.getByLabelText('City') as HTMLSelectElement).value).toBe('city-b');
    rerender(<CheckoutPanel {...props} initialQuote={{ ...quote, version: 1, destinationCityId: 'city-a' }} />);
    expect((screen.getByLabelText('City') as HTMLSelectElement).value).toBe('city-b');
  });
  it('distinguishes an expired server quote from an expired reservation still requiring release', () => {
    const { rerender } = render(<CheckoutPanel {...props} initialQuote={{ ...quote, state: 'EXPIRED', expiresAt: '2000-01-01T00:00:00Z' }} />);
    expect(screen.getByText(/This quote has expired. No stock is held/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Release reserved stock' })).toBeNull();
    cleanup();
    render(<CheckoutPanel {...props} initialQuote={{ ...quote, expiresAt: '2000-01-01T00:00:00Z' }} />);
    expect(screen.getByText(/Release it to return the stock/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Release reserved stock' })).toBeTruthy();
  });
  it('uses the chosen recipient city in the reservation request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...quote, destinationCityId: 'city-a' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CheckoutPanel {...props} initialQuote={null} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'city-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve stock and get quote' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/checkout/quotes');
    expect(JSON.parse(options.body)).toMatchObject({ destinationCityId: 'city-a', expectedVersion: 1 });
    await waitFor(() => expect((screen.getByLabelText('City') as HTMLSelectElement).disabled).toBe(true));
    expect(screen.getByText('City A')).toBeTruthy();
  });
});
