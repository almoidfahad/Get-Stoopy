import Link from 'next/link';
import { CART_ISSUE_MESSAGES, summarizeCart } from '@getstoopy/core';
import { Shell } from '@/components/shell';
import { CheckoutPanel } from '@/components/checkout-panel';
import { getOrCreateCart } from '@/lib/cart';
import { readQuote } from '@/lib/checkout';
import type { QuoteInput } from '@getstoopy/core';
import { fetchServiceableCities } from '@/lib/serviceability';

export const dynamic = 'force-dynamic';

function Notice({ title, body, signIn = false }: { title: string; body: string; signIn?: boolean }) {
  return (
    <Shell>
      <div className="max-w-xl rounded-2xl border border-neutral-200 bg-neutral-50 p-8">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-neutral-700">{body}</p>
        <div className="mt-5 flex gap-3">
          {signIn ? (
            <Link href="/login" className="rounded-lg bg-brand-red px-5 py-3 font-semibold text-white">Sign in</Link>
          ) : null}
          <Link href="/cart" className="rounded-lg border border-neutral-300 px-5 py-3 font-semibold">Back to cart</Link>
        </div>
      </div>
    </Shell>
  );
}

/**
 * Checkout: reserve stock and show a quote.
 *
 * Payment is intentionally absent. The quote API reports delivery, total and
 * payment as unimplemented, and this page reports the same thing rather than
 * presenting a subtotal as a grand total.
 */
export default async function CheckoutPage() {
  const result = await getOrCreateCart();

  if (result.state !== 'ok') {
    const copy =
      result.state === 'sign-in'
        ? { title: 'Sign in to check out', body: 'Checkout uses your account cart, so you need to be signed in.', signIn: true }
        : result.state === 'not-configured'
          ? { title: 'Market not configured', body: 'This deployment has no market country set, so checkout is unavailable. No demo cart is substituted.', signIn: false }
          : { title: 'Checkout unavailable', body: 'The cart service could not be reached. Please try again shortly.', signIn: false };
    return <Notice title={copy.title} body={copy.body} signIn={copy.signIn} />;
  }

  const cart = result.cart;
  const summary = summarizeCart(cart.items);

  // Recovery must not depend on today's cart validity or serviceability: an
  // existing reservation can outlive either of them.
  let initialQuote: QuoteInput | null = null;
  if (cart.activeQuoteId) {
    const existing = await readQuote(cart.activeQuoteId);
    if (existing.status !== 200) {
      return <Notice title="Reserved quote unavailable" body="Your cart may still have reserved stock, but the quote could not be loaded. Please reload this page and try again; the reservation may still be active." />;
    }
    initialQuote = existing.body as QuoteInput;
  }

  if (!initialQuote && cart.items.length === 0) {
    return <Notice title="Your cart is empty" body="Add something to your cart before requesting a delivery quote." />;
  }

  if (!initialQuote && !summary.readyForCheckout) {
    return (
      <Shell>
        <h1 className="text-3xl font-bold">Checkout</h1>
        <div className="mt-6 max-w-xl rounded-2xl border border-brand-red bg-red-50 p-6">
          <h2 className="text-lg font-semibold text-brand-red">Resolve your cart first</h2>
          <ul className="mt-3 space-y-1 text-sm font-medium text-brand-red">
            {summary.issues.map((issue, index) => (
              <li key={`${issue.kind}-${index}`}>{CART_ISSUE_MESSAGES[issue.kind]}</li>
            ))}
          </ul>
          <Link href="/cart" className="mt-4 inline-block rounded-lg border border-neutral-400 px-4 py-2 text-sm font-semibold">
            Back to cart
          </Link>
        </div>
      </Shell>
    );
  }

  const cities = await fetchServiceableCities();

  if (!initialQuote && cities.state === 'not-configured') {
    return <Notice title="Market not configured" body="This deployment has no market country set, so delivery cities cannot be listed." />;
  }
  if (!initialQuote && cities.state === 'unavailable') {
    return <Notice title="Delivery cities unavailable" body="The list of serviceable cities could not be loaded. Please try again shortly." />;
  }
  if (!initialQuote && cities.state === 'ok' && cities.data.items.length === 0) {
    return (
      <Notice
        title="No delivery cities yet"
        body="No store in this market has approved delivery coverage yet, so no destination can be quoted. Nothing has been reserved."
      />
    );
  }

  const reservationUnavailable = !summary.readyForCheckout || cart.items.length === 0
    ? 'Your cart is not ready for a new quote. Return to the cart to resolve its issues.'
    : cities.state !== 'ok'
      ? 'Delivery cities could not be loaded. Reload the page before requesting a new quote.'
      : cities.data.items.length === 0
        ? 'No delivery cities are currently available for a new quote.'
        : null;

  return (
    <Shell>
      <h1 className="text-3xl font-bold">Checkout</h1>
      <p className="mt-1 text-neutral-600">
        {summary.lineCount} {summary.lineCount === 1 ? 'item' : 'items'} · {summary.unitCount}{' '}
        {summary.unitCount === 1 ? 'unit' : 'units'}
      </p>
      <CheckoutPanel
        cartVersion={cart.version}
        currency={summary.currency ?? cart.currency}
        cities={cities.state === 'ok' ? cities.data.items : []}
        truncated={cities.state === 'ok' && cities.data.truncated}
        reservationUnavailable={reservationUnavailable}
        initialQuote={initialQuote}
      />
      <Link href="/cart" className="mt-6 inline-block text-sm font-semibold text-brand-red">Back to cart</Link>
    </Shell>
  );
}
