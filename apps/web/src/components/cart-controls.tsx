'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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
      return status >= 500 ? 'The cart service is unavailable. Please try again.' : 'Could not update your cart.';
  }
}

export function useCartMutation() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function send(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>): Promise<boolean> {
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
      setError('The cart service is unavailable. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { send, error, done, working: busy || pending };
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
  const { send, error, done, working } = useCartMutation();
  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState(variants[0]?.id ?? '');
  const disabled = variants.length === 0 || selected === '';

  if (!signedIn) {
    return (
      <p className="rounded-lg border border-neutral-300 bg-white p-4 text-sm">
        <a href="/login" className="font-semibold text-brand-red">Sign in</a> to add this item to your cart.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        {variants.length > 1 ? (
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">Option</span>
            <select
              value={selected}
              onChange={event => setSelected(event.target.value)}
              className="rounded-lg border border-neutral-300 px-3 py-2"
            >
              {variants.map(variant => (
                <option key={variant.id} value={variant.id}>{variant.label}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium">Quantity</span>
          <input
            type="number"
            min={1}
            max={100}
            value={quantity}
            onChange={event => {
              const next = Number(event.target.value);
              setQuantity(Number.isInteger(next) && next >= 1 && next <= 100 ? next : 1);
            }}
            className="w-24 rounded-lg border border-neutral-300 px-3 py-2"
          />
        </label>
        <button
          type="button"
          disabled={disabled || working}
          onClick={() => void send('POST', { variantId: selected, quantity })}
          className="rounded-lg bg-brand-red px-6 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {working ? 'Adding…' : 'Add to cart'}
        </button>
      </div>
      {error ? <p role="alert" className="text-sm font-medium text-brand-red">{error}</p> : null}
      {done && !error ? (
        <p role="status" className="text-sm">
          Added. <a href="/cart" className="font-semibold text-brand-red">View cart</a>
        </p>
      ) : null}
    </div>
  );
}

export function CartLineControls({
  variantId,
  quantity,
  version,
}: {
  variantId: string;
  quantity: number;
  version: number;
}) {
  const { send, error, working } = useCartMutation();

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Decrease quantity"
          disabled={working || quantity <= 1}
          onClick={() => void send('PATCH', { variantId, quantity: quantity - 1, expectedVersion: version })}
          className="h-9 w-9 rounded-lg border border-neutral-300 font-semibold disabled:opacity-40"
        >
          −
        </button>
        <span aria-live="polite" className="w-10 text-center font-medium">{quantity}</span>
        <button
          type="button"
          aria-label="Increase quantity"
          disabled={working || quantity >= 100}
          onClick={() => void send('PATCH', { variantId, quantity: quantity + 1, expectedVersion: version })}
          className="h-9 w-9 rounded-lg border border-neutral-300 font-semibold disabled:opacity-40"
        >
          +
        </button>
        <button
          type="button"
          disabled={working}
          onClick={() => void send('DELETE', { variantId, expectedVersion: version })}
          className="ml-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium disabled:opacity-40"
        >
          Remove
        </button>
      </div>
      {error ? <p role="alert" className="max-w-xs text-right text-sm font-medium text-brand-red">{error}</p> : null}
    </div>
  );
}