'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
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

interface ReservationAttempt { destinationCityId: string; expectedVersion: number; attemptId: string }

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

// A 2xx response with an unreadable or unrelated quote does not prove release.
// Validate the fields used to render before adopting a release response.
function isReleasedQuote(value: unknown, previous: QuoteInput): value is QuoteInput {
  if (!value || typeof value !== 'object') return false;
  const q = value as Record<string, unknown>;
  if (q.quoteId !== previous.quoteId || q.cartId !== previous.cartId || typeof q.state !== 'string' || !['RELEASED', 'EXPIRED', 'CONSUMED'].includes(q.state) ||
      !Number.isInteger(q.version) || (q.version as number) < previous.version || typeof q.currency !== 'string' ||
      typeof q.destinationCityId !== 'string' || typeof q.subtotalMinor !== 'string' || typeof q.expiresAt !== 'string' ||
      !(q.closedAt === null || typeof q.closedAt === 'string') || !(q.deliveryFeeMinor === null || typeof q.deliveryFeeMinor === 'string') ||
      !(q.totalMinor === null || typeof q.totalMinor === 'string') || typeof q.paymentStatus !== 'string' ||
      !Array.isArray(q.items) || !Array.isArray(q.groups)) return false;
  return q.items.every((value: unknown) => {
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    return typeof item.itemId === 'string' && typeof item.groupId === 'string' && typeof item.variantId === 'string' &&
      typeof item.productTitle === 'string' && typeof item.quantity === 'number' && Number.isFinite(item.quantity) &&
      typeof item.unitPriceMinor === 'string' && typeof item.lineTotalMinor === 'string' && typeof item.currency === 'string';
  }) && q.groups.every((value: unknown) => {
    if (!value || typeof value !== 'object') return false;
    const group = value as Record<string, unknown>;
    return typeof group.groupId === 'string' && typeof group.storeId === 'string' &&
      typeof group.subtotalMinor === 'string' && typeof group.currency === 'string';
  });
}

export function CheckoutPanel({ cartVersion, cities, truncated, initialQuote, reservationUnavailable }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [cityId, setCityId] = useState('');
  const [quote, setQuote] = useState<QuoteInput | null>(initialQuote);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  // An uncertain response must be retried with the *entire* original payload,
  // not just its key: a refresh can change cartVersion in this same component.
  const attempt = useRef<ReservationAttempt | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [releaseUncertain, setReleaseUncertain] = useState(false);
  const inFlight = useRef(false);
  const releaseButtonRef = useRef<HTMLButtonElement>(null);
  const quoteHeadingRef = useRef<HTMLHeadingElement>(null);
  const reservationHelpId = useId();

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
    // A recovered quote may belong to a different attempt. Keep any uncertain
    // attempt until its own result is resolved; the recovered hold can be released.
    setQuote(current =>
      current && current.quoteId === initialQuote.quoteId && current.version >= initialQuote.version
        ? current
        : initialQuote,
    );
  }, [initialQuote]);

  function adoptReleasedQuote(next: QuoteInput) {
    // The release control is removed when the quote no longer holds stock.
    // Move focus only if the user is still on it, not if they moved elsewhere.
    if (next.state !== 'RESERVED' && document.activeElement === releaseButtonRef.current) quoteHeadingRef.current?.focus();
    setQuote(next);
  }

  async function readExisting(id: string): Promise<void> {
    const res = await fetch(`/api/checkout/quotes/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (res.ok) adoptReleasedQuote((await res.json()) as QuoteInput);
  }

  async function reserve(): Promise<void> {
    if (inFlight.current || releaseUncertain || (reservationUnavailable && !attempt.current) || quote?.state === 'RESERVED') return;
    if (!cityId && !attempt.current) {
      setError('Choose a delivery city first.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      attempt.current ??= { destinationCityId: cityId, expectedVersion: cartVersion, attemptId: newAttemptId() };
      const request = attempt.current;
      const res = await fetch('/api/checkout/quotes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      const payload = (await res.json().catch(() => ({}))) as QuoteInput & { code?: string };
      if (!res.ok) {
        // Only a first, explicit rejection resolves the attempt. After an
        // uncertain response the earlier request may still be in flight even if
        // a retry receives a conflict, so keep the original payload in that case.
        const rejected = !uncertain && res.status >= 400 && res.status < 500 && [
          'CHECKOUT_CART_VERSION_CONFLICT', 'CHECKOUT_DESTINATION_NOT_SERVICEABLE',
          'CHECKOUT_ACTIVE_QUOTE_LIMIT', 'CART_EMPTY', 'CART_ITEM_LIMIT',
        ].includes(payload.code ?? '');
        if (rejected) { attempt.current = null; setUncertain(false); }
        else setUncertain(true);
        setError(rejected ? quoteErrorMessage(payload.code, res.status) :
          `${payload.code === 'SIGN_IN_REQUIRED' || payload.code === 'CHECKOUT_QUOTE_ALREADY_RESERVED' ? `${quoteErrorMessage(payload.code, res.status)} ` : ''}The reservation result is unknown. Stock may be held. Retry the same request or reload checkout to check for a quote.`);
        // A quote from an earlier visit is still holding stock. Refreshing reloads
        // the cart, which names the active quote so it can be released here.
        if (payload.code === 'CHECKOUT_QUOTE_ALREADY_RESERVED' || payload.code === 'CHECKOUT_CART_VERSION_CONFLICT') {
          startTransition(() => router.refresh());
        }
        return;
      }
      setQuote(payload);
      attempt.current = null;
      setUncertain(false);
      startTransition(() => router.refresh());
    } catch {
      setUncertain(true);
      setError('The reservation result is unknown. Stock may be held. Retry the same request or reload checkout to check for a quote.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function release(): Promise<void> {
    if (!quote || inFlight.current || releaseUncertain) return;
    inFlight.current = true;
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
        if (res.status >= 500) {
          setReleaseUncertain(true);
          setError('The release result is unknown. Stock may still be held, or it may have been released.');
        } else {
          setError(quoteErrorMessage(payload.code, res.status));
          if (payload.code === 'CHECKOUT_QUOTE_VERSION_CONFLICT') await readExisting(quote.quoteId);
        }
        return;
      }
      if (!isReleasedQuote(payload, quote)) {
        setReleaseUncertain(true);
        setError('The release result is unknown. Stock may still be held, or it may have been released.');
        return;
      }
      adoptReleasedQuote(payload);
      startTransition(() => router.refresh());
    } catch {
      setReleaseUncertain(true);
      setError('The release result is unknown. Stock may still be held, or it may have been released.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const summary = quote && now !== null ? summarizeQuote(quote, new Date(now)) : null;
  const subtotal = summary?.subtotalMinor != null && summary.issues.length === 0 && summary.currency
    ? formatMinorUnits(summary.subtotalMinor.toString(), summary.currency) : null;
  const minutes = summary ? Math.floor(summary.secondsRemaining / 60) : 0;
  const seconds = summary ? summary.secondsRemaining % 60 : 0;
  // A recovered reservation belongs to its original city, even if this tab
  // never selected it or the current city list no longer includes it.
  const reservedCityId = quote?.state === 'RESERVED' ? quote.destinationCityId : null;
  const selectedCityId = reservedCityId ?? (uncertain ? attempt.current?.destinationCityId : undefined) ?? cityId;
  const quoteCity = quote ? cities.find(city => city.cityId === quote.destinationCityId) : undefined;
  const reserveBlocked = busy || releaseUncertain || (!uncertain && (!!reservationUnavailable || !cityId)) || quote?.state === 'RESERVED';

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
          disabled={busy || uncertain || releaseUncertain || !!reservationUnavailable || quote?.state === 'RESERVED'}
          onChange={event => {
            setCityId(event.target.value);
          }}
          className="mt-2 min-h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 disabled:bg-neutral-100"
        >
          <option value="">Choose a city</option>
          {selectedCityId && !cities.some(city => city.cityId === selectedCityId) ? <option value={selectedCityId}>City details unavailable for this {reservedCityId ? 'quote' : 'request'}</option> : null}
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

        {/* A focusable aria-disabled button requires an explicit activation guard. */}
        <button
          type="button"
          onClick={() => { if (!reserveBlocked) void reserve(); }}
          aria-disabled={reserveBlocked}
          aria-describedby={reservationHelpId}
          className="mt-5 min-h-12 rounded-full bg-brand-red px-6 py-3 font-bold text-white hover:bg-brand-red-hover aria-disabled:cursor-not-allowed aria-disabled:bg-neutral-300 aria-disabled:text-neutral-700"
        >
          {busy ? 'Working…' : uncertain ? 'Retry same reservation request' : 'Reserve stock and get quote'}
        </button>
        <p id={reservationHelpId} className="mt-2 text-sm text-neutral-600">
          {releaseUncertain ? 'Release status is unknown; reload checkout to check it. ' : quote?.state === 'RESERVED' ? 'Stock is already reserved for this quote. ' : reservationUnavailable && !uncertain ? `${reservationUnavailable} ` : !cityId && !uncertain ? 'Choose a delivery city before requesting a quote. ' : ''}This holds the items for a short time. It is not an order and no payment is taken.
        </p>
        {busy ? <p role="status" className="sr-only">Updating reservation…</p> : null}

        {reservationUnavailable ? (
          <p role="status" className="mt-4 text-sm text-neutral-700">{reservationUnavailable}</p>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 rounded-lg border border-brand-red bg-red-50 p-3 text-sm font-medium text-brand-red">
            {error}
          </p>
        ) : null}

        {releaseUncertain ? (
          <div className="mt-4 rounded-lg border border-neutral-300 bg-neutral-50 p-4 text-sm leading-6 text-neutral-800">
            <p>Reload checkout to check the latest quote. The earlier request may still finish after the reload.</p>
            <a href="/checkout" className="mt-2 inline-flex min-h-11 items-center font-bold text-brand-red underline">Reload checkout</a>
          </div>
        ) : null}

        {quote && summary ? (
          <div className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 ref={quoteHeadingRef} tabIndex={-1} className="font-semibold">Quote</h3>
              <span role="status" className="rounded-full border border-neutral-300 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                {releaseUncertain ? `Last known: ${summary.status}` : summary.status}
              </span>
            </div>

            <p className="mt-3 text-sm text-neutral-700">Quote city: <span className="font-semibold">{quoteCity?.name ?? 'City details unavailable'}</span></p>

            {!releaseUncertain && summary.status === 'reserved' ? (
              <p className="mt-2 text-sm text-neutral-700">
                Stock held for{' '}
                <span className="font-semibold">
                  {minutes}:{String(seconds).padStart(2, '0')}
                </span>
              </p>
            ) : null}
            {!releaseUncertain && summary.status === 'unknown' ? (
              <p className="mt-2 text-sm text-neutral-700">{summary.canRelease ? 'Reservation expiry is unavailable. Stock may still be held; you can release it below.' : 'The stock-hold status is unavailable. Refresh this page and try again.'}</p>
            ) : null}
            {!releaseUncertain && summary.status === 'expired' ? (
              <p className="mt-2 text-sm text-neutral-700">
                {summary.canRelease
                  ? 'This quote has expired. Release it to return the stock, then request a new one.'
                  : 'This quote has expired. No stock is held by this quote any more.'}
              </p>
            ) : null}

            <ul className="mt-3 space-y-1 text-sm">
              {quote.items.map(item => (
                <li key={item.itemId} className="flex justify-between gap-4">
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                    {item.productTitle} × {item.quantity}
                  </span>
                  <span className="font-semibold">
                    {summary.issues.some(issue => issue.itemId === item.itemId && ['price-invalid', 'line-total-mismatch', 'currency-invalid'].includes(issue.kind)) ? 'Line total unavailable' : formatMinorUnits(item.lineTotalMinor, item.currency) ?? 'Line total unavailable'}
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
                ref={releaseButtonRef}
                onClick={() => { if (!busy && !releaseUncertain) void release(); }}
                aria-disabled={busy || releaseUncertain}
                className="mt-4 min-h-11 rounded-full border border-neutral-400 bg-white px-5 py-2 text-sm font-bold hover:border-neutral-900 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
              >
                Release reserved stock
              </button>
            ) : !releaseUncertain && summary.status !== 'unknown' ? (
              <p className="mt-4 text-sm text-neutral-700">
                No stock is held by this quote any more.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <aside className="h-fit rounded-2xl border border-[#eee4d8] bg-[#faf5ee] p-6">
        <h2 className="text-lg font-bold">Quote summary</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd className="font-bold">{subtotal ?? (summary?.issues.length ? 'Unavailable' : 'Not quoted yet')}</dd>
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
