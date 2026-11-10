'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';

/**
 * Shared error copy for cart calls. A version conflict is explained rather than
 * retried automatically: silently re-applying a change could overwrite an edit
 * made in another tab.
 */
function messageFor(code: string | undefined, status: number): string {
  switch (code) {
    case 'SIGN_IN_REQUIRED':
      return 'Please sign in to use your cart.';
    case 'CART_VERSION_CONFLICT':
    case 'CHECKOUT_CART_VERSION_CONFLICT':
      return 'Your cart changed in another tab. The page has been refreshed — please try again.';
    case 'CART_QUANTITY_LIMIT':
      return 'That item is limited to 100 units per cart.';
    case 'CART_ITEM_LIMIT':
      return 'Your cart can hold at most 50 different items.';
    case 'CART_VARIANT_NOT_SELLABLE':
      return 'That option is no longer available for sale.';
    case 'CART_COUNTRY_MISMATCH':
      return 'That item is not sold in this market.';
    case 'MARKET_NOT_CONFIGURED':
      return 'This deployment has no market configured yet.';
    case 'ORIGIN_DENIED':
      return 'That request was rejected. Reload the page and try again.';
    default:
      return status >= 500 ? 'The cart service is unavailable. Check your cart before trying again.' : 'Could not update your cart.';
  }
}

export function useCartMutation() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const [done, setDone] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);

  function clearFeedback() { if (!uncertain) { setError(null); setSignInRequired(false); } setDone(false); }
  function acknowledgeUncertain() { setUncertain(false); setError(null); }

  async function send(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>, onSuccess?: () => void): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setSignInRequired(false);
    setDone(false);
    try {
      const res = await fetch('/api/cart/items', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const raw: unknown = await res.json().catch(() => null);
      const payload = raw && typeof raw === 'object' ? raw as { code?: string; mutationConfirmed?: unknown } : {};
      if (!res.ok) {
        if (res.status >= 500) {
          setUncertain(true);
          setError('The request may have succeeded, but its result is unknown. It may still complete later.');
        } else {
          setError(messageFor(payload.code, res.status));
          if (res.status === 401 && payload.code === 'SIGN_IN_REQUIRED') setSignInRequired(true);
        }
        if (payload.code === 'CART_VERSION_CONFLICT') startTransition(() => router.refresh());
        return false;
      }
      // Only the BFF can confirm that its upstream response matched the action.
      if (payload.mutationConfirmed !== true) {
        setUncertain(true);
        setError('The request may have succeeded, but its result is unknown. It may still complete later.');
        return false;
      }
      setDone(true);
      // Focus recovery must happen before a refresh removes the active control.
      onSuccess?.();
      startTransition(() => router.refresh());
      return true;
    } catch {
      setUncertain(true);
      setError('The request may have succeeded, but its result is unknown. It may still complete later.');
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { send, error, signInRequired, done, uncertain, working: busy || pending, clearFeedback, acknowledgeUncertain };
}

export interface OrderableVariant {
  id: string;
  label: string;
  priceLabel: string;
}

export function AddToCart({
  variants,
  signedIn,
}: {
  variants: readonly OrderableVariant[];
  signedIn: boolean;
}) {
  const { send, error, signInRequired, done, uncertain, working, clearFeedback, acknowledgeUncertain } = useCartMutation();
  const quantityHelpId = useId();
  const selectionHelpId = useId();
  const uncertainHelpId = useId();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [quantity, setQuantity] = useState('1');
  const [selected, setSelected] = useState('');
  const selectedOption = variants.find(variant => variant.id === selected);
  const selectedAvailable = !!selectedOption;
  // Do not silently restore a choice if it disappears and later returns.
  useEffect(() => { if (selected && !selectedAvailable) setSelected(''); }, [selected, selectedAvailable]);
  const effectiveSelected = selectedAvailable ? selected : '';
  const validQuantity = /^\d+$/.test(quantity) && Number(quantity) >= 1 && Number(quantity) <= 100;
  const disabled = !selectedAvailable || !validQuantity || uncertain;

  if (!signedIn) {
    return (
      <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm leading-6">
        <a href="/login" className="font-semibold text-brand-red">Sign in</a> to add this item to your cart.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex w-full min-w-0 flex-col text-sm sm:w-auto sm:max-w-full">
          <span className="mb-1 font-medium">Option</span>
          <select
            value={effectiveSelected}
            disabled={working}
            onChange={event => { setSelected(event.target.value); clearFeedback(); }}
            className="min-h-12 w-full max-w-full rounded-xl border border-neutral-300 bg-white px-3 py-2"
          >
            <option value="" disabled>Choose an available option</option>
            {variants.map(variant => (
              <option key={variant.id} value={variant.id}>{variant.label} — {variant.priceLabel} each</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium">Quantity</span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={3}
            value={quantity}
            disabled={working}
            aria-invalid={!validQuantity || undefined}
            aria-describedby={!validQuantity ? quantityHelpId : undefined}
            onChange={event => { setQuantity(event.target.value); clearFeedback(); }}
            className="min-h-12 w-24 rounded-xl border border-neutral-300 bg-white px-3 py-2"
          />
        </label>
        {/* Keep focus through pending/uncertain states; aria-disabled needs the explicit click guard below. */}
        <button
          type="button"
          ref={addButtonRef}
          aria-disabled={disabled || working}
          aria-describedby={[!selectedAvailable ? selectionHelpId : null, !validQuantity ? quantityHelpId : null, uncertain ? uncertainHelpId : null].filter(Boolean).join(' ') || undefined}
          onClick={() => { if (!disabled && !working) void send('POST', { variantId: effectiveSelected, quantity: Number(quantity) }); }}
          className="min-h-12 rounded-full bg-brand-red px-6 py-3 font-bold text-white hover:bg-brand-red-hover aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          {working ? 'Adding…' : 'Add to cart'}
        </button>
      </div>
      <p id={selectionHelpId} aria-live="polite" className="text-sm leading-6 text-neutral-700 [overflow-wrap:anywhere]">{selectedOption ? <>Selected: <span className="font-semibold">{selectedOption.label}</span> · {selectedOption.priceLabel} each</> : 'Choose an option before adding to your cart.'}</p>
      <p className="text-xs leading-5 text-neutral-600">Price and availability may change; adding to your cart does not reserve stock.</p>
      {!validQuantity ? <p id={quantityHelpId} className="text-sm font-medium text-brand-red">Enter a whole number between 1 and 100.</p> : null}
      {working ? <p role="status" className="sr-only">Adding to cart…</p> : null}
      {error ? <p role="alert" className="text-sm font-medium text-brand-red">{error}</p> : null}
      {signInRequired ? <a href="/login" className="inline-flex min-h-11 items-center self-start text-sm font-bold text-brand-red underline">Go to sign in</a> : null}
      {uncertain ? (
        <div id={uncertainHelpId} className="rounded-xl border border-red-200 bg-white p-4 text-sm leading-6 text-neutral-800">
          <p>Check your cart before adding again. A reload cannot guarantee that an earlier request won’t finish later.</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
            <a href="/cart" className="inline-flex min-h-11 items-center font-bold text-brand-red underline">View cart</a>
            <button type="button" onClick={() => { acknowledgeUncertain(); addButtonRef.current?.focus(); }} className="min-h-11 text-left font-bold text-neutral-900 underline">I understand, enable adding again</button>
          </div>
        </div>
      ) : null}
      {done && !error && selectedAvailable ? (
        <p role="status" className="text-sm">
          Added. <a href="/cart" className="font-semibold text-brand-red">View cart</a>
        </p>
      ) : null}
    </div>
  );
}

export function CartLineControls({
  variantId,
  productTitle,
  quantity,
  version,
}: {
  variantId: string;
  productTitle: string;
  quantity: number;
  version: number;
}) {
  const { send, error, signInRequired, uncertain, working } = useCartMutation();
  const removeButtonRef = useRef<HTMLButtonElement>(null);

  function recoverFocusAfterRemoval() {
    // Respect a user who has moved elsewhere while the request was pending.
    if (document.activeElement === removeButtonRef.current) document.getElementById('cart-page-heading')?.focus();
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease quantity for ${productTitle}`}
          aria-disabled={working || uncertain || quantity <= 1}
          onClick={() => { if (!working && !uncertain && quantity > 1) void send('PATCH', { variantId, quantity: quantity - 1, expectedVersion: version }); }}
          className="h-11 w-11 rounded-xl border border-neutral-300 font-semibold hover:border-neutral-900 aria-disabled:opacity-40"
        >
          −
        </button>
        <span aria-live="polite" aria-label={`Quantity for ${productTitle}: ${quantity}`} className="w-8 text-center font-medium">{quantity}</span>
        <button
          type="button"
          aria-label={`Increase quantity for ${productTitle}`}
          aria-disabled={working || uncertain || quantity >= 100}
          onClick={() => { if (!working && !uncertain && quantity < 100) void send('PATCH', { variantId, quantity: quantity + 1, expectedVersion: version }); }}
          className="h-11 w-11 rounded-xl border border-neutral-300 font-semibold hover:border-neutral-900 aria-disabled:opacity-40"
        >
          +
        </button>
        <button
          type="button"
          ref={removeButtonRef}
          aria-disabled={working || uncertain}
          aria-label={`Remove ${productTitle} from cart`}
          onClick={() => { if (!working && !uncertain) void send('DELETE', { variantId, expectedVersion: version }, recoverFocusAfterRemoval); }}
          className="min-h-11 rounded-xl border border-neutral-300 px-4 py-2 text-sm font-semibold hover:border-neutral-900 aria-disabled:opacity-40"
        >
          Remove
        </button>
      </div>
      {working ? <p role="status" className="text-sm text-neutral-700">Updating cart…</p> : null}
      {error ? <p role="alert" className="max-w-xs text-left text-sm font-medium text-brand-red sm:text-right">{error}</p> : null}
      {signInRequired ? <a href="/login" className="inline-flex min-h-11 items-center text-sm font-bold text-brand-red underline">Go to sign in</a> : null}
      {uncertain ? <p className="max-w-xs text-left text-sm leading-6 text-neutral-700 sm:text-right">Review your cart before making another change. <a href="/cart" className="font-bold text-brand-red underline">Reload cart</a>; an earlier request may still complete later.</p> : null}
    </div>
  );
}
