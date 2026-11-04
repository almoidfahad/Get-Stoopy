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
  /** A quote already holding this cart's stock, recovered after a reload. */
  initialQuote: QuoteInput | null;
}

function newAttemptId(): string {
  return crypto.randomUUID();
}

export function CheckoutPanel({ cartVersion, currency, cities, truncated, initialQuote }: Props) {
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

  async function readExisting(id: string): Promise<void> {
    const res = await fetch(`/api/checkout/quotes/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (res.ok) setQuote((await res.json()) as QuoteInput);
  }

  async function reserve(): Promise<void> {
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

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
      <section className="rounded-2xl border border-neutral-200 p-6">
        <h2 className="text-lg font-semibold">Delivery city</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Only cities where a store can actually deliver are listed.
        </p>

        <label htmlFor="destination-city" className="mt-4 block text-sm font-semibold">
          City
        </label>
        <select
          id="destination-city"
          value={cityId}
          disabled={busy || summary?.canRelease === true}
          onChange={event => {
            setCityId(event.target.value);
            attemptId.current = null;
          }}
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 disabled:bg-neutral-100"
        >
          <option value="">Choose a city</option>
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
          disabled={busy || !cityId || summary?.canRelease === true}
          className="mt-4 rounded-lg bg-brand-red px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
        >
          {busy ? 'Working…' : 'Reserve stock and get quote'}
        </button>
        <p className="mt-2 text-sm text-neutral-600">
          This holds the items for a short time. It is not an order and no payment is taken.
        </p>

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
                This quote has expired. Release it to return the stock, then request a new one.
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
                className="mt-4 rounded-lg border border-neutral-400 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
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

      <aside className="h-fit rounded-2xl border border-neutral-200 bg-neutral-50 p-6">
        <h2 className="text-lg font-semibold">Summary</h2>
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
          className="mt-5 w-full cursor-not-allowed rounded-lg bg-neutral-300 px-5 py-3 font-semibold text-neutral-600"
        >
          Payment not available
        </button>
      </aside>
    </div>
  );
}
