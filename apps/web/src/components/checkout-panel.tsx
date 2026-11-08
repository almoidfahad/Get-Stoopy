'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  QUOTE_ISSUE_MESSAGES,
  formatMinorUnits,
  quoteErrorMessage,
  summarizeQuote,
  type QuoteInput,
} from '@getstoopy/core/browser';
import type { ServiceableCity } from '@/lib/serviceability';

/**
 * The checkout quote panel.
 *
 * It reserves stock and shows what the backend actually knows. Delivery, total
 * and payment are still unimplemented server-side, so they are labelled as such
 * rather than filled in with the subtotal. There is deliberately no "Pay" button.
 */

interface Props {
  cartVersion: number;
  currency: string;
  cities: ServiceableCity[];
  truncated: boolean;
  reservationUnavailable: string | null;
  /** A quote already holding this cart's stock, recovered after a reload. */
  initialQuote: QuoteInput | null;
}

function newAttemptId(): string {
  return crypto.randomUUID();
}

export function CheckoutPanel({ cartVersion, currency, cities, truncated, initialQuote, reservationUnavailable }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [cityId, setCityId] = useState('');
  const [quote, setQuote] = useState<QuoteInput | null>(initialQuote);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  // One key per attempt: a double click or a network retry reuses it, so the API
  // returns the same quote instead of reserving the stock twice.
  const attemptId = useRef<string | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // A refresh can surface a quote this tab did not create (the ALREADY_RESERVED
  // recovery path). Adopt it, but never let a null prop wipe a quote this tab is
  // showing, and never move backwards to an older version of the same quote.
  useEffect(() => {
    if (!initialQuote) return;
    setQuote(current =>
      current && current.quoteId === initialQuote.quoteId && current.version >= initialQuote.version
        ? current
        : initialQuote,
    );
  }, [initialQuote]);

  async function readExisting(id: string): Promise<void> {
    const res = await fetch(`/api/checkout/quotes/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (res.ok) setQuote((await res.json()) as QuoteInput);
  }

  async function reserve(): Promise<void> {
    if (reservationUnavailable || quote?.state === 'RESERVED') return;
    if (!cityId) {
      setError('Choose a delivery city first.');
      return;
    }
    setBusy(true);
    setError(null);
    attemptId.current ??= newAttemptId();
    try {
      const res = await fetch('/api/checkout/quotes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ destinationCityId: cityId, expectedVersion: cartVersion, attemptId: attemptId.current }),
      });
      const payload = (await res.json().catch(() => ({}))) as QuoteInput & { code?: string };
      if (!res.ok) {
        setError(quoteErrorMessage(payload.code, res.status));
        // A quote from an earlier visit is still holding stock. Refreshing reloads
        // the cart, which names the active quote so it can be released here.
        if (payload.code === 'CHECKOUT_QUOTE_ALREADY_RESERVED' || payload.code === 'CHECKOUT_CART_VERSION_CONFLICT') {
          startTransition(() => router.refresh());
        }
        return;
      }
      setQuote(payload);
      attemptId.current = null;
      startTransition(() => router.refresh());
    } catch {
      setError(quoteErrorMessage('QUOTE_UNAVAILABLE', 502));
    } finally {
      setBusy(false);
    }
  }

  async function release(): Promise<void> {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/checkout/quotes/${encodeURIComponent(quote.quoteId)}/release`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: quote.version }),
      });
      const payload = (await res.json().catch(() => ({}))) as QuoteInput & { code?: string };
      if (!res.ok) {
        setError(quoteErrorMessage(payload.code, res.status));
        if (payload.code === 'CHECKOUT_QUOTE_VERSION_CONFLICT') await readExisting(quote.quoteId);
        return;
      }
      setQuote(payload);
      startTransition(() => router.refresh());
    } catch {
      setError(quoteErrorMessage('QUOTE_UNAVAILABLE', 502));
    } finally {
      setBusy(false);
    }
  }

  const summary = quote && now !== null ? summarizeQuote(quote, new Date(now)) : null;
  const subtotal = summary?.subtotalMinor != null ? formatMinorUnits(summary.subtotalMinor.toString(), quote?.currency ?? currency) : null;
  const minutes = summary ? Math.floor(summary.secondsRemaining / 60) : 0;
  const seconds = summary ? summary.secondsRemaining % 60 : 0;
  // A recovered reservation belongs to its original city, even if this tab
  // never selected it or the current city list no longer includes it.
  const reservedCityId = quote?.state === 'RESERVED' ? quote.destinationCityId : null;
  const selectedCityId = reservedCityId ?? cityId;
  const quoteCity = quote ? cities.find(city => city.cityId === quote.destinationCityId) : undefined;

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
      <section className="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8">
        <p className="section-eyebrow">Delivery destination</p>
        <h2 className="mt-2 text-xl font-bold">Delivery city</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Choose the recipient’s city, whether the delivery is for you or someone else. Cities with reported store coverage are listed; availability for your cart is checked when you request a quote.
        </p>

        <p className="mt-3 text-sm leading-6 text-neutral-600">This quote only uses the city. Recipient details and delivery addresses are not collected yet, and placing an order is not available.</p>

        <label htmlFor="destination-city" className="mt-4 block text-sm font-semibold">
          City
        </label>
        <select
          id="destination-city"
          value={selectedCityId}
          disabled={busy || !!reservationUnavailable || quote?.state === 'RESERVED'}
          onChange={event => {
            setCityId(event.target.value);
            attemptId.current = null;
          }}
          className="mt-2 min-h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 disabled:bg-neutral-100"
        >
          <option value="">Choose a city</option>
          {reservedCityId && !quoteCity ? <option value={reservedCityId}>City details unavailable for this quote</option> : null}
          {cities.map(city => (
            <option key={city.cityId} value={city.cityId}>
              {city.name} — {city.storeCount} {city.storeCount === 1 ? 'store' : 'stores'}
            </option>
          ))}
        </select>
        {truncated ? (
          <p className="mt-2 text-sm text-neutral-600">
            More cities are served than can be listed here. The list is capped; this is not the full coverage map.
          </p>
        ) : null}

        <button
          type="button"
          onClick={reserve}
          disabled={busy || !!reservationUnavailable || !cityId || quote?.state === 'RESERVED'}
          className="mt-5 min-h-12 rounded-full bg-brand-red px-6 py-3 font-bold text-white hover:bg-brand-red-hover disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-700"
        >
          {busy ? 'Working…' : 'Reserve stock and get quote'}
        </button>
        <p className="mt-2 text-sm text-neutral-600">
          This holds the items for a short time. It is not an order and no payment is taken.
        </p>

        {reservationUnavailable ? (
          <p role="status" className="mt-4 text-sm text-neutral-700">{reservationUnavailable}</p>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 rounded-lg border border-brand-red bg-red-50 p-3 text-sm font-medium text-brand-red">
            {error}
          </p>
        ) : null}

        {quote && summary ? (
          <div className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Quote</h3>
              <span className="rounded-full border border-neutral-300 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                {summary.status}
              </span>
            </div>

            <p className="mt-3 text-sm text-neutral-700">Quote city: <span className="font-semibold">{quoteCity?.name ?? 'City details unavailable'}</span></p>

            {summary.status === 'reserved' ? (
              <p className="mt-2 text-sm text-neutral-700">
                Stock held for{' '}
                <span className="font-semibold">
                  {minutes}:{String(seconds).padStart(2, '0')}
                </span>
              </p>
            ) : null}
            {summary.status === 'expired' ? (
              <p className="mt-2 text-sm text-neutral-700">
                {summary.canRelease
                  ? 'This quote has expired. Release it to return the stock, then request a new one.'
                  : 'This quote has expired. No stock is held by this quote any more.'}
              </p>
            ) : null}

            <ul className="mt-3 space-y-1 text-sm">
              {quote.items.map(item => (
                <li key={item.itemId} className="flex justify-between gap-4">
                  <span className="min-w-0">
                    {item.productTitle} × {item.quantity}
                  </span>
                  <span className="font-semibold">
                    {formatMinorUnits(item.lineTotalMinor, item.currency) ?? '—'}
                  </span>
                </li>
              ))}
            </ul>

            {summary.issues.length > 0 ? (
              <ul role="alert" className="mt-3 space-y-1 text-sm font-medium text-brand-red">
                {summary.issues.map((issue, index) => (
                  <li key={`${issue.kind}-${index}`}>{QUOTE_ISSUE_MESSAGES[issue.kind]}</li>
                ))}
              </ul>
            ) : null}

            {summary.canRelease ? (
              <button
                type="button"
                onClick={release}
                disabled={busy}
                className="mt-4 min-h-11 rounded-full border border-neutral-400 bg-white px-5 py-2 text-sm font-bold hover:border-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Release reserved stock
              </button>
            ) : (
              <p className="mt-4 text-sm text-neutral-700">
                No stock is held by this quote any more.
              </p>
            )}
          </div>
        ) : null}
      </section>

      <aside className="h-fit rounded-2xl border border-[#eee4d8] bg-[#faf5ee] p-6">
        <h2 className="text-lg font-bold">Quote summary</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd className="font-bold">{subtotal ?? 'Not quoted yet'}</dd>
          </div>
          <div className="flex justify-between text-neutral-600">
            <dt>Delivery</dt>
            <dd>{summary?.totalsImplemented ? 'Calculated' : 'Not implemented'}</dd>
          </div>
          <div className="flex justify-between text-neutral-600">
            <dt>Total</dt>
            <dd>{summary?.totalsImplemented ? 'Calculated' : 'Not implemented'}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-neutral-700">
          Delivery charges, taxes and payment are not implemented yet, so no grand total is shown and no money
          is taken. Placing an order is not available in this environment.
        </p>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="mt-5 min-h-12 w-full cursor-not-allowed rounded-full bg-neutral-300 px-5 py-3 font-bold text-neutral-700"
        >
          Payment not available
        </button>
      </aside>
    </div>
  );
}
