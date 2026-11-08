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

describe('quote safety and recovery', () => {
  const item = { itemId: 'item', groupId: 'group', variantId: 'variant', productTitle: 'Item', quantity: 2, unitPriceMinor: '100', lineTotalMinor: '99999', currency: 'BDT' };
  it('withholds an inconsistent line amount and subtotal while keeping release available', () => {
    render(<CheckoutPanel {...props} initialQuote={{ ...quote, subtotalMinor: '99999', items: [item], groups: [{ groupId: 'group', storeId: 'store', subtotalMinor: '99999', currency: 'BDT' }] }} />);
    expect(screen.getByText('Line total unavailable')).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.getByText(/A line total no longer matches/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Release reserved stock' })).toBeTruthy();
  });
  it('renders malformed item currency as unavailable, not an exception', () => {
    render(<CheckoutPanel {...props} initialQuote={{ ...quote, currency: '', items: [{ ...item, currency: '', lineTotalMinor: '200' }], subtotalMinor: '200' }} />);
    expect(screen.getByText('Line total unavailable')).toBeTruthy();
    expect(screen.getAllByText(/currency in this quote is unavailable/).length).toBeGreaterThan(0);
  });
  it('withholds the subtotal when a store subtotal is inconsistent', () => {
    render(<CheckoutPanel {...props} initialQuote={{ ...quote, subtotalMinor: '200', items: [{ ...item, lineTotalMinor: '200' }], groups: [{ groupId: 'group', storeId: 'store', subtotalMinor: '100', currency: 'BDT' }] }} />);
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.getByText(/A store subtotal no longer matches/)).toBeTruthy();
    expect(screen.queryByText('Line total unavailable')).toBeNull();
  });
  it('keeps an invalid-expiry reservation releasable without a false timer', () => {
    render(<CheckoutPanel {...props} initialQuote={{ ...quote, expiresAt: 'bad date' }} />);
    expect(screen.getByText(/Reservation expiry is unavailable/)).toBeTruthy();
    expect(screen.queryByText(/Stock held for/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Release reserved stock' })).toBeTruthy();
  });
  it('does not claim that an unknown state holds no stock', () => {
    render(<CheckoutPanel {...props} initialQuote={{ ...quote, state: 'NEW_STATE' }} />);
    expect(screen.getByText(/stock-hold status is unavailable/)).toBeTruthy();
    expect(screen.queryByText(/No stock is held/)).toBeNull();
  });
  it('sends only one release request while one is in flight', async () => {
    let finish!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CheckoutPanel {...props} initialQuote={quote} />);
    const button = screen.getByRole('button', { name: 'Release reserved stock' });
    fireEvent.click(button); fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(new Response(JSON.stringify({ ...quote, state: 'RELEASED', version: 2 }), { status: 200 }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Release reserved stock' })).toBeNull());
  });
  it('sends only one reservation request while one is in flight', async () => {
    let finish!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CheckoutPanel {...props} initialQuote={null} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'city-a' } });
    const button = screen.getByRole('button', { name: 'Reserve stock and get quote' });
    fireEvent.click(button); fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(new Response(JSON.stringify({ ...quote, destinationCityId: 'city-a' }), { status: 200 }));
    await waitFor(() => expect(screen.getByText('City A')).toBeTruthy());
  });
});
