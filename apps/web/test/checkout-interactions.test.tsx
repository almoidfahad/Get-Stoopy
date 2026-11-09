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
  it('keeps focus through a release and moves it to the quote heading when the control disappears', async () => {
    let finish!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CheckoutPanel {...props} initialQuote={quote} />);
    const button = screen.getByRole('button', { name: 'Release reserved stock' });
    button.focus();
    fireEvent.click(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Updating reservation…').getAttribute('role')).toBe('status');
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(new Response(JSON.stringify({ ...quote, state: 'RELEASED', version: 2 }), { status: 200 }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Release reserved stock' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Quote' }));
  });
  it('moves focus to the quote when conflict recovery discovers it was already released', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'CHECKOUT_QUOTE_VERSION_CONFLICT' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...quote, state: 'RELEASED', version: 2 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CheckoutPanel {...props} initialQuote={quote} />);
    const button = screen.getByRole('button', { name: 'Release reserved stock' });
    button.focus(); fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Release reserved stock' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Quote' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('does not steal focus when the user moves away while a release is pending', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; })));
    render(<CheckoutPanel {...props} initialQuote={quote} />);
    const button = screen.getByRole('button', { name: 'Release reserved stock' });
    button.focus(); fireEvent.click(button);
    const reserve = screen.getByRole('button', { name: 'Working…' });
    reserve.focus();
    finish(new Response(JSON.stringify({ ...quote, state: 'RELEASED', version: 2 }), { status: 200 }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Release reserved stock' })).toBeNull());
    expect(document.activeElement).toBe(reserve);
  });
  it('keeps focus and the original retry payload after an uncertain reservation', async () => {
    let finish!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CheckoutPanel {...props} initialQuote={null} />);
    const button = screen.getByRole('button', { name: 'Reserve stock and get quote' });
    button.focus();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'city-a' } });
    fireEvent.click(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(new Response('{}', { status: 503 }));
    const retry = await screen.findByRole('button', { name: 'Retry same reservation request' });
    expect(retry).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(retry.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(retry);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
    finish(new Response(JSON.stringify({ ...quote, destinationCityId: 'city-a' }), { status: 200 }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Release reserved stock' })).toBeTruthy());
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

describe('uncertain reservation requests', () => {
  it('retries the original payload after a network failure even when the cart version and city list change', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(
      new Response(JSON.stringify({ ...quote, destinationCityId: 'city-a' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<CheckoutPanel {...props} initialQuote={null} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'city-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve stock and get quote' }));
    await screen.findByRole('button', { name: 'Retry same reservation request' });
    expect(screen.getByRole('alert').textContent).toMatch(/Stock may be held/);
    rerender(<CheckoutPanel {...props} cartVersion={2} cities={[cities[1]!]} reservationUnavailable="Cart not ready" initialQuote={null} />);
    const city = screen.getByLabelText('City') as HTMLSelectElement;
    expect(city.disabled).toBe(true);
    expect(city.value).toBe('city-a');
    expect(city.selectedOptions[0]?.textContent).toBe('City details unavailable for this request');
    fireEvent.click(screen.getByRole('button', { name: 'Retry same reservation request' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual(JSON.parse(fetchMock.mock.calls[0]![1].body));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Release reserved stock' })).toBeTruthy());
  });

  it('allows a new attempt after an authoritative cart version conflict', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'CHECKOUT_CART_VERSION_CONFLICT' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(quote), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<CheckoutPanel {...props} initialQuote={null} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'city-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve stock and get quote' }));
    await screen.findByRole('alert');
    expect(mocks.refresh).toHaveBeenCalled();
    rerender(<CheckoutPanel {...props} cartVersion={2} initialQuote={null} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'city-b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve stock and get quote' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = JSON.parse(fetchMock.mock.calls[0]![1].body);
    const second = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(second).toMatchObject({ destinationCityId: 'city-b', expectedVersion: 2 });
    expect(second.attemptId).not.toBe(first.attemptId);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Release reserved stock' })).toBeTruthy());
  });

  it('preserves an uncertain attempt after an authentication error and while a recovered quote is displayed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'SIGN_IN_REQUIRED' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<CheckoutPanel {...props} initialQuote={null} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'city-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve stock and get quote' }));
    await screen.findByRole('button', { name: 'Retry same reservation request' });
    rerender(<CheckoutPanel {...props} initialQuote={quote} />);
    expect(await screen.findByRole('button', { name: 'Release reserved stock' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry same reservation request' }).getAttribute('aria-disabled')).toBe('true');
    expect((screen.getByLabelText('City') as HTMLSelectElement).value).toBe('city-b');
  });
});

describe('reservation retry after a server failure', () => {
  it('keeps the same key and payload after a 502 rather than creating a fresh attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'QUOTE_UNAVAILABLE' }), { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...quote, destinationCityId: 'city-a' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CheckoutPanel {...props} initialQuote={null} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'city-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve stock and get quote' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry same reservation request' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Release reserved stock' })).toBeTruthy());
  });
});

it('does not discard an uncertain attempt when its retry gets a version conflict', async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'CHECKOUT_CART_VERSION_CONFLICT' }), { status: 409 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...quote, destinationCityId: 'city-a' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const { rerender } = render(<CheckoutPanel {...props} initialQuote={null} />);
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'city-a' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reserve stock and get quote' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry same reservation request' }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  rerender(<CheckoutPanel {...props} cartVersion={2} initialQuote={null} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry same reservation request' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(fetchMock.mock.calls[2]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Release reserved stock' })).toBeTruthy());
});
