'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';

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
  const [done, setDone] = useState(false);
  const inFlight = useRef(false);

  function clearFeedback() { setError(null); setDone(false); }

  async function send(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch('/api/cart/items', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as { code?: string };
      if (!res.ok) {
        setError(messageFor(payload.code, res.status));
        if (payload.code === 'CART_VERSION_CONFLICT') startTransition(() => router.refresh());
        return false;
      }
      setDone(true);
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError('The cart service could not be reached. Check your cart before trying again.');
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { send, error, done, working: busy || pending, clearFeedback };
}

export interface OrderableVariant {
  id: string;
  label: string;
}

export function AddToCart({
  variants,
  signedIn,
}: {
  variants: readonly OrderableVariant[];
  signedIn: boolean;
}) {
  const { send, error, done, working, clearFeedback } = useCartMutation();
  const quantityHelpId = useId();
  const [quantity, setQuantity] = useState('1');
  const [selected, setSelected] = useState(variants[0]?.id ?? '');
  const selectedAvailable = variants.some(variant => variant.id === selected);
  const effectiveSelected = selectedAvailable ? selected : '';
  const validQuantity = /^\d+$/.test(quantity) && Number(quantity) >= 1 && Number(quantity) <= 100;
  const disabled = !selectedAvailable || !validQuantity;

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
        {variants.length > 1 || (variants.length > 0 && !selectedAvailable) ? (
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">Option</span>
            <select
              value={effectiveSelected}
              disabled={working}
              onChange={event => { setSelected(event.target.value); clearFeedback(); }}
              className="min-h-12 rounded-xl border border-neutral-300 bg-white px-3 py-2"
            >
              <option value="" disabled>Choose an available option</option>
              {variants.map(variant => (
                <option key={variant.id} value={variant.id}>{variant.label}</option>
              ))}
            </select>
          </label>
        ) : null}
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
        <button
          type="button"
          disabled={disabled || working}
          onClick={() => void send('POST', { variantId: effectiveSelected, quantity: Number(quantity) })}
          className="min-h-12 rounded-full bg-brand-red px-6 py-3 font-bold text-white hover:bg-brand-red-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {working ? 'Adding…' : 'Add to cart'}
        </button>
      </div>
      {!validQuantity ? <p id={quantityHelpId} className="text-sm font-medium text-brand-red">Enter a whole number between 1 and 100.</p> : null}
      {error ? <p role="alert" className="text-sm font-medium text-brand-red">{error}</p> : null}
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
  const { send, error, working } = useCartMutation();

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease quantity for ${productTitle}`}
          disabled={working || quantity <= 1}
          onClick={() => void send('PATCH', { variantId, quantity: quantity - 1, expectedVersion: version })}
          className="h-11 w-11 rounded-xl border border-neutral-300 font-semibold hover:border-neutral-900 disabled:opacity-40"
        >
          −
        </button>
        <span aria-live="polite" aria-label={`Quantity for ${productTitle}: ${quantity}`} className="w-8 text-center font-medium">{quantity}</span>
        <button
          type="button"
          aria-label={`Increase quantity for ${productTitle}`}
          disabled={working || quantity >= 100}
          onClick={() => void send('PATCH', { variantId, quantity: quantity + 1, expectedVersion: version })}
          className="h-11 w-11 rounded-xl border border-neutral-300 font-semibold hover:border-neutral-900 disabled:opacity-40"
        >
          +
        </button>
        <button
          type="button"
          disabled={working}
          aria-label={`Remove ${productTitle} from cart`}
          onClick={() => void send('DELETE', { variantId, expectedVersion: version })}
          className="min-h-11 rounded-xl border border-neutral-300 px-4 py-2 text-sm font-semibold hover:border-neutral-900 disabled:opacity-40"
        >
          Remove
        </button>
      </div>
      {error ? <p role="alert" className="max-w-xs text-left text-sm font-medium text-brand-red sm:text-right">{error}</p> : null}
    </div>
  );
}