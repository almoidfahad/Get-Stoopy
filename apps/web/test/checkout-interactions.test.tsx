// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QuoteInput } from '@getstoopy/core/browser';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { CheckoutPanel } from '../src/components/checkout-panel';

const quoteId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const cartId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cityA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const cityB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const cities = [{ cityId: cityA, name: 'City A', code: 'A', storeCount: 1 }, { cityId: cityB, name: 'City B', code: 'B', storeCount: 2 }];
const quote: QuoteInput = { quoteId: quoteId, cartId: cartId, currency: 'BDT', state: 'RESERVED', destinationCityId: cityB, subtotalMinor: '0', version: 1, expiresAt: '2100-01-01T00:00:00Z', closedAt: null, deliveryFeeMinor: null, totalMinor: null, paymentStatus: 'NOT_IMPLEMENTED', groups: [{ groupId: 'group', storeId: 'store', subtotalMinor: '0', currency: 'BDT' }], items: [{ itemId: 'item', groupId: 'group', variantId: 'variant', productTitle: 'Fixture item', quantity: 1, unitPriceMinor: '0', lineTotalMinor: '0', currency: 'BDT' }] };
const props = { cartId: cartId, cartVersion: 1, currency: 'BDT', cities, truncated: false, reservationUnavailable: null };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('checkout destination and quote recovery interactions', () => {
  it('shows a recovered reservation’s actual city and prevents changing it', () => {
    render(<CheckoutPanel {...props} initialQuote={quote} />);
    const select = screen.getByLabelText('City') as HTMLSelectElement;
    expect(select.value).toBe(cityB);
    expect(select.disabled).toBe(true);
    expect(screen.getByText('City B')).toBeTruthy();
    expect(screen.getByText(/Recipient details and delivery addresses are not collected yet/)).toBeTruthy();
  });
  it('matches a recovered quote city regardless of identifier case', () => {
    render(<CheckoutPanel {...props} initialQuote={{ ...quote, destinationCityId: cityB.toUpperCase() }} />);
    const select = screen.getByLabelText('City') as HTMLSelectElement;
    expect(select.value).toBe(cityB);
    expect(select.selectedOptions[0]?.textContent).toContain('City B');
    expect(screen.getByText('City B')).toBeTruthy();
    expect(screen.queryByText('City details unavailable')).toBeNull();
  });
  it('does not substitute another city if the quote city is missing from the list', () => {
    render(<CheckoutPanel {...props} cities={[cities[0]!]} initialQuote={quote} />);
    const select = screen.getByLabelText('City') as HTMLSelectElement;
    expect(select.value).toBe(cityB);
    expect(select.selectedOptions[0]?.textContent).toBe('City details unavailable for this quote');
    expect(screen.getByText('City details unavailable')).toBeTruthy();
  });
  it('adopts a recovered quote after refresh and ignores older versions of it', () => {
    const { rerender } = render(<CheckoutPanel {...props} initialQuote={null} />);
    rerender(<CheckoutPanel {...props} initialQuote={{ ...quote, version: 2 }} />);
    expect((screen.getByLabelText('City') as HTMLSelectElement).value).toBe(cityB);
    rerender(<CheckoutPanel {...props} initialQuote={{ ...quote, version: 1, destinationCityId: cityA }} />);
    expect((screen.getByLabelText('City') as HTMLSelectElement).value).toBe(cityB);
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
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...quote, destinationCityId: cityA }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CheckoutPanel {...props} initialQuote={null} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: cityA } });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve stock and get quote' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/checkout/quotes');
    expect(JSON.parse(options.body)).toMatchObject({ destinationCityId: cityA, expectedVersion: 1 });
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
    expect(screen.getByRole('alert').querySelector('ul > li')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Release reserved stock' })).toBeTruthy();
  });
  it('withholds an orphaned line and subtotal, warns, and keeps the reservation releasable', () => {
    render(<CheckoutPanel {...props} initialQuote={{ ...quote, subtotalMinor: '200', items: [{ ...item, groupId: 'missing', lineTotalMinor: '200' }], groups: [] }} />);
    expect(screen.getByText('Line total unavailable')).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('items or stores in this quote could not be verified');
    expect(screen.getByRole('alert').querySelector('ul > li')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Release reserved stock' }).getAttribute('aria-disabled')).toBe('false');
  });
  it('labels an empty quote as unavailable rather than not quoted', () => {
    render(<CheckoutPanel {...props} initialQuote={{ ...quote, items: [], groups: [] }} />);
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.queryByText('Not quoted yet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Release reserved stock' })).toBeTruthy();
  });
  it('withholds every line when a duplicated identifier makes the quote ambiguous', () => {
    const first = quote.items[0]!;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<CheckoutPanel {...props} initialQuote={{ ...quote, items: [first, { ...first, variantId: 'another' }] }} />);
      expect(screen.getAllByText('Line total unavailable')).toHaveLength(2);
      expect(screen.getByText('Unavailable')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Release reserved stock' })).toBeTruthy();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
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
  it.each(['network', 'server', 'malformed-json', 'wrong-quote', 'reserved', 'malformed-items', 'invalid-quote-id', 'invalid-city-id', 'same-version', 'older-version', 'unsafe-version'] as const)(
    'treats %s release responses as uncertain and prevents a new action until reload', async kind => {
      const fetchMock = kind === 'network' ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn().mockResolvedValue(
        kind === 'server' ? new Response('{}', { status: 503 }) :
        kind === 'malformed-json' ? new Response('not json', { status: 200 }) :
        new Response(JSON.stringify({ ...quote, state: kind === 'reserved' ? 'RESERVED' : 'RELEASED', version: kind === 'same-version' ? 1 : kind === 'older-version' ? 0 : kind === 'unsafe-version' ? Number.MAX_SAFE_INTEGER + 1 : 2,
          quoteId: kind === 'wrong-quote' ? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' : kind === 'invalid-quote-id' ? '../not-a-uuid' : quote.quoteId,
          destinationCityId: kind === 'invalid-city-id' ? 'bad-city' : quote.destinationCityId,
          items: kind === 'malformed-items' ? [{ itemId: 'broken' }] : [] }), { status: 200 })
      );
      vi.stubGlobal('fetch', fetchMock);
      const { rerender } = render(<CheckoutPanel {...props} initialQuote={quote} />);
      const release = screen.getByRole('button', { name: 'Release reserved stock' });
      release.focus(); fireEvent.click(release);
      expect((await screen.findByRole('alert')).textContent).toContain('release result is unknown');
      expect(document.activeElement).toBe(release);
      expect(release.getAttribute('aria-disabled')).toBe('true');
      expect(screen.getByText('Last known: reserved')).toBeTruthy();
      expect(screen.queryByText(/Stock held for/)).toBeNull();
      expect(screen.queryByText(/Stock is already reserved for this quote/)).toBeNull();
      expect(screen.getByText(/earlier request may still finish after the reload/)).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Reload checkout' }).getAttribute('href')).toBe('/checkout');
      fireEvent.click(release);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      rerender(<CheckoutPanel {...props} initialQuote={{ ...quote, state: 'RELEASED', version: 2 }} />);
      const reserve = await screen.findByRole('button', { name: 'Reserve stock and get quote' });
      expect(reserve.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(reserve);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/No stock is held by this quote/)).toBeNull();
    },
  );
  it('accepts case-equivalent quote and cart identities in a newer closed response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...quote, quoteId: quoteId.toUpperCase(), cartId: cartId.toUpperCase(), state: 'RELEASED', version: 2 }), { status: 200 })));
    render(<CheckoutPanel {...props} initialQuote={quote} />);
    const release = screen.getByRole('button', { name: 'Release reserved stock' });
    release.focus(); fireEvent.click(release);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Release reserved stock' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Quote' }));
    expect(screen.queryByRole('link', { name: 'Reload checkout' })).toBeNull();
  });
  it('does not regress a newer quote when refreshed identifiers differ only by case', async () => {
    const { rerender } = render(<CheckoutPanel {...props} initialQuote={{ ...quote, version: 2, destinationCityId: cityA }} />);
    rerender(<CheckoutPanel {...props} initialQuote={{ ...quote, quoteId: quoteId.toUpperCase(), cartId: cartId.toUpperCase(), version: 1 }} />);
    await waitFor(() => expect((screen.getByLabelText('City') as HTMLSelectElement).value).toBe(cityA));
  });
  it('does not accept a closed response contradicting a same-version reserved refresh', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; })));
    const { rerender } = render(<CheckoutPanel {...props} initialQuote={quote} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release reserved stock' }));
    rerender(<CheckoutPanel {...props} initialQuote={{ ...quote, version: 2, destinationCityId: cityA }} />);
    await waitFor(() => expect((screen.getByLabelText('City') as HTMLSelectElement).value).toBe(cityA));
    finish(new Response(JSON.stringify({ ...quote, state: 'RELEASED', version: 2 }), { status: 200 }));
    expect((await screen.findByRole('alert')).textContent).toContain('release result is unknown');
    expect(screen.getByText('Last known: reserved')).toBeTruthy();
    expect(screen.queryByText(/No stock is held by this quote/)).toBeNull();
  });
  it('does not classify an explicit release rejection as an unknown outcome', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'ORIGIN_DENIED' }), { status: 403 })));
    render(<CheckoutPanel {...props} initialQuote={quote} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release reserved stock' }));
    expect((await screen.findByRole('alert')).textContent).toContain('request was rejected');
    expect(screen.queryByRole('link', { name: 'Reload checkout' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Release reserved stock' }).getAttribute('aria-disabled')).toBe('false');
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
  it.each(['server', 'network', 'bad-json', 'malformed', 'wrong-quote', 'wrong-cart', 'invalid-city-id', 'older', 'same-version'] as const)(
    'requires reload when a conflicting quote cannot be read reliably: %s', async kind => {
      const latest = { ...quote, state: 'RELEASED',
        quoteId: kind === 'wrong-quote' ? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' : quote.quoteId,
        cartId: kind === 'wrong-cart' ? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' : quote.cartId,
        destinationCityId: kind === 'invalid-city-id' ? 'bad-city' : quote.destinationCityId,
        version: kind === 'older' ? 0 : kind === 'same-version' ? 1 : 2 };
      const second = kind === 'network' ? Promise.reject(new Error('offline')) : Promise.resolve(
        kind === 'server' ? new Response('{}', { status: 503 }) :
        new Response(kind === 'bad-json' ? 'broken' : JSON.stringify(kind === 'malformed' ? {} : latest), { status: 200 }));
      const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'CHECKOUT_QUOTE_VERSION_CONFLICT' }), { status: 409 }))
        .mockImplementationOnce(() => second);
      vi.stubGlobal('fetch', fetchMock);
      render(<CheckoutPanel {...props} initialQuote={quote} />);
      const release = screen.getByRole('button', { name: 'Release reserved stock' });
      release.focus(); fireEvent.click(release);
      expect((await screen.findByRole('alert')).textContent).toContain('current status could not be loaded');
      expect(document.activeElement).toBe(release);
      expect(release.getAttribute('aria-disabled')).toBe('true');
      expect(screen.getByText('Last known: reserved')).toBeTruthy();
      expect(screen.queryByText(/Stock held for/)).toBeNull();
      expect(screen.queryByText(/page has been refreshed/)).toBeNull();
      expect(screen.getByRole('link', { name: 'Reload checkout' }).getAttribute('href')).toBe('/checkout');
      fireEvent.click(release);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
  it('does not overwrite a newer quote that arrives while conflict recovery is pending', async () => {
    let finishRead!: (value: Response) => void;
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'CHECKOUT_QUOTE_VERSION_CONFLICT' }), { status: 409 }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finishRead = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<CheckoutPanel {...props} initialQuote={quote} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release reserved stock' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    rerender(<CheckoutPanel {...props} initialQuote={{ ...quote, version: 3, destinationCityId: cityA }} />);
    await waitFor(() => expect((screen.getByLabelText('City') as HTMLSelectElement).value).toBe(cityA));
    finishRead(new Response(JSON.stringify({ ...quote, state: 'RELEASED', version: 2 }), { status: 200 }));
    expect((await screen.findByRole('alert')).textContent).toContain('current status could not be loaded');
    expect((screen.getByLabelText('City') as HTMLSelectElement).value).toBe(cityA);
    expect(screen.getByText('Last known: reserved')).toBeTruthy();
  });
  it('does not overwrite a newer quote with an older successful release response', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; })));
    const { rerender } = render(<CheckoutPanel {...props} initialQuote={quote} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release reserved stock' }));
    rerender(<CheckoutPanel {...props} initialQuote={{ ...quote, version: 3, destinationCityId: cityA }} />);
    await waitFor(() => expect((screen.getByLabelText('City') as HTMLSelectElement).value).toBe(cityA));
    finish(new Response(JSON.stringify({ ...quote, state: 'RELEASED', version: 2 }), { status: 200 }));
    expect((await screen.findByRole('alert')).textContent).toContain('release result is unknown');
    expect(screen.getByText('Last known: reserved')).toBeTruthy();
    expect((screen.getByLabelText('City') as HTMLSelectElement).value).toBe(cityA);
  });
  it('shows newer reserved quote details after a successful conflict recovery', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'CHECKOUT_QUOTE_VERSION_CONFLICT' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...quote, version: 2 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CheckoutPanel {...props} initialQuote={quote} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release reserved stock' }));
    expect((await screen.findByRole('alert')).textContent).toContain('latest available details');
    expect(screen.queryByRole('link', { name: 'Reload checkout' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Release reserved stock' }).getAttribute('aria-disabled')).toBe('false');
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
    fireEvent.change(screen.getByLabelText('City'), { target: { value: cityA } });
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
    finish(new Response(JSON.stringify({ ...quote, destinationCityId: cityA }), { status: 200 }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Release reserved stock' })).toBeTruthy());
  });
  it('sends only one reservation request while one is in flight', async () => {
    let finish!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CheckoutPanel {...props} initialQuote={null} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: cityA } });
    const button = screen.getByRole('button', { name: 'Reserve stock and get quote' });
    fireEvent.click(button); fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(new Response(JSON.stringify({ ...quote, destinationCityId: cityA }), { status: 200 }));
    await waitFor(() => expect(screen.getByText('City A')).toBeTruthy());
  });
});

describe('uncertain reservation requests', () => {
  it('retries the original payload after a network failure even when the cart version and city list change', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(
      new Response(JSON.stringify({ ...quote, destinationCityId: cityA }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<CheckoutPanel {...props} initialQuote={null} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: cityA } });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve stock and get quote' }));
    await screen.findByRole('button', { name: 'Retry same reservation request' });
    expect(screen.getByRole('alert').textContent).toMatch(/Stock may be held/);
    rerender(<CheckoutPanel {...props} cartVersion={2} cities={[cities[1]!]} reservationUnavailable="Cart not ready" initialQuote={null} />);
    const city = screen.getByLabelText('City') as HTMLSelectElement;
    expect(city.disabled).toBe(true);
    expect(city.value).toBe(cityA);
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
    fireEvent.change(screen.getByLabelText('City'), { target: { value: cityA } });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve stock and get quote' }));
    await screen.findByRole('alert');
    expect(mocks.refresh).toHaveBeenCalled();
    rerender(<CheckoutPanel {...props} cartVersion={2} initialQuote={null} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: cityB } });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve stock and get quote' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = JSON.parse(fetchMock.mock.calls[0]![1].body);
    const second = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(second).toMatchObject({ destinationCityId: cityB, expectedVersion: 2 });
    expect(second.attemptId).not.toBe(first.attemptId);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Release reserved stock' })).toBeTruthy());
  });

  it('preserves an uncertain attempt after an authentication error and while a recovered quote is displayed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'SIGN_IN_REQUIRED' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<CheckoutPanel {...props} initialQuote={null} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: cityA } });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve stock and get quote' }));
    await screen.findByRole('button', { name: 'Retry same reservation request' });
    expect(screen.getByRole('link', { name: 'Go to sign in' }).getAttribute('href')).toBe('/login');
    expect(screen.getByText(/may lose its saved retry request/)).toBeTruthy();
    expect(screen.getByText(/earlier request may still finish later/)).toBeTruthy();
    rerender(<CheckoutPanel {...props} initialQuote={quote} />);
    expect(await screen.findByRole('button', { name: 'Release reserved stock' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry same reservation request' }).getAttribute('aria-disabled')).toBe('true');
    expect((screen.getByLabelText('City') as HTMLSelectElement).value).toBe(cityB);
  });
});

describe('unreadable reservation success responses', () => {
  it.each(['invalid-json', 'null', 'missing', 'invalid-quote-id', 'invalid-cart-id', 'invalid-city-id', 'wrong-cart', 'wrong-city', 'unknown-state', 'invalid-item', 'invalid-version', 'unsafe-version'] as const)(
    'keeps the original attempt when a 2xx response is %s', async kind => {
      const good = { ...quote, destinationCityId: cityA };
      const candidate = kind === 'null' ? null : kind === 'missing' ? {} : {
        ...good,
        quoteId: kind === 'invalid-quote-id' ? '../bad-quote' : good.quoteId,
        cartId: kind === 'invalid-cart-id' ? 'bad-cart' : kind === 'wrong-cart' ? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' : good.cartId,
        destinationCityId: kind === 'invalid-city-id' ? 'bad-city' : kind === 'wrong-city' ? cityB : good.destinationCityId,
        state: kind === 'unknown-state' ? 'UNRECOGNIZED' : good.state,
        items: kind === 'invalid-item' ? [{ itemId: 'broken' }] : good.items,
        version: kind === 'invalid-version' ? 0 : kind === 'unsafe-version' ? Number.MAX_SAFE_INTEGER + 1 : good.version,
      };
      const fetchMock = vi.fn().mockResolvedValueOnce(new Response(kind === 'invalid-json' ? 'broken' : JSON.stringify(candidate), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(good), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const { rerender } = render(<CheckoutPanel {...props} initialQuote={null} />);
      fireEvent.change(screen.getByLabelText('City'), { target: { value: cityA } });
      const button = screen.getByRole('button', { name: 'Reserve stock and get quote' });
      button.focus(); fireEvent.click(button);
      const retry = await screen.findByRole('button', { name: 'Retry same reservation request' });
      expect(screen.getByRole('alert').textContent).toContain('reservation result is unknown');
      expect(document.activeElement).toBe(retry);
      expect(screen.queryByRole('button', { name: 'Release reserved stock' })).toBeNull();
      expect((screen.getByLabelText('City') as HTMLSelectElement).disabled).toBe(true);
      rerender(<CheckoutPanel {...props} cartId="changed-cart" cartVersion={9} initialQuote={null} />);
      fireEvent.click(retry);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
      expect(Object.keys(JSON.parse(fetchMock.mock.calls[0]![1].body)).sort()).toEqual(['attemptId', 'destinationCityId', 'expectedVersion']);
      await screen.findByRole('button', { name: 'Release reserved stock' });
    },
  );
  it('accepts a valid closed quote when an idempotent retry returns an already closed attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('broken', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...quote, destinationCityId: cityA, state: 'EXPIRED', version: 2 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CheckoutPanel {...props} initialQuote={null} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: cityA } });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve stock and get quote' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry same reservation request' }));
    await waitFor(() => expect(screen.getByText('expired')).toBeTruthy());
    expect(screen.queryByText(/reservation result is unknown/)).toBeNull();
    expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
  });
});

describe('reservation retry after a server failure', () => {
  it('keeps the same key and payload after a 502 rather than creating a fresh attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'QUOTE_UNAVAILABLE' }), { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...quote, destinationCityId: cityA }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CheckoutPanel {...props} initialQuote={null} />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: cityA } });
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
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...quote, destinationCityId: cityA }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const { rerender } = render(<CheckoutPanel {...props} initialQuote={null} />);
  fireEvent.change(screen.getByLabelText('City'), { target: { value: cityA } });
  fireEvent.click(screen.getByRole('button', { name: 'Reserve stock and get quote' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry same reservation request' }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  rerender(<CheckoutPanel {...props} cartVersion={2} initialQuote={null} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry same reservation request' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(fetchMock.mock.calls[2]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Release reserved stock' })).toBeTruthy());
});
