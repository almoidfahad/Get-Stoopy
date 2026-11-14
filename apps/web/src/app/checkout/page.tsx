import Link from 'next/link';
import { CART_ISSUE_MESSAGES, summarizeCart } from '@getstoopy/core';
import { Shell } from '@/components/shell';
import { CheckoutPanel } from '@/components/checkout-panel';
import { getOrCreateCart } from '@/lib/cart';
import { readQuote } from '@/lib/checkout';
import type { QuoteInput } from '@getstoopy/core';
import { isQuoteInput } from '@/lib/quote-validation';
import { fetchServiceableCities } from '@/lib/serviceability';
import { CommerceHeader, CommerceNotice } from '@/components/commerce-layout';
import { ArrowLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

function Notice({ title, body, signIn = false, retry = false }: { title: string; body: string; signIn?: boolean; retry?: boolean }) {
  return <CommerceNotice stage="Checkout" title={title} body={body} signIn={signIn} retry={retry} />;
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
          ? { title: 'Checkout not available yet', body: 'Checkout services aren’t available here yet. Please check back later.', signIn: false }
          : { title: 'Checkout unavailable', body: 'The cart service could not be reached. Please try again shortly.', signIn: false };
    return <Notice title={copy.title} body={copy.body} signIn={copy.signIn} retry={result.state === 'unavailable'} />;
  }

  const cart = result.cart;
  const summary = summarizeCart(cart.items);

  // Recovery must not depend on today's cart validity or serviceability: an
  // existing reservation can outlive either of them.
  let initialQuote: QuoteInput | null = null;
  if (cart.activeQuoteId) {
    const existing = await readQuote(cart.activeQuoteId);
    if (existing.status !== 200 || !isQuoteInput(existing.body) ||
        existing.body.quoteId.toLowerCase() !== cart.activeQuoteId.toLowerCase() ||
        existing.body.cartId.toLowerCase() !== cart.cartId.toLowerCase()) {
      return <Notice retry title="Reserved quote unavailable" body="Your cart may still have reserved stock, but the quote could not be loaded. Please reload this page and try again; the reservation may still be active." />;
    }
    initialQuote = existing.body;
  }

  if (!initialQuote && cart.items.length === 0) {
    return <Notice title="Your cart is empty" body="Add something to your cart before requesting a delivery quote." />;
  }

  if (!initialQuote && !summary.readyForCheckout) {
    return (
      <Shell>
        <CommerceHeader stage="Checkout" title="Checkout" />
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
          <p className="mt-4 text-sm leading-6 text-neutral-700">Explore the <Link href="/checkout/recipient-preview" className="font-bold text-brand-red underline">recipient details layout preview</Link>. It is not an order form.</p>
        </div>
      </Shell>
    );
  }

  const cities = await fetchServiceableCities();

  if (!initialQuote && cities.state === 'not-configured') {
    return <Notice title="Delivery cities not available yet" body="Delivery cities aren’t available to browse here yet. Please check back later." />;
  }
  if (!initialQuote && cities.state === 'unavailable') {
    return <Notice retry title="Delivery cities unavailable" body="The list of serviceable cities could not be loaded. Please try again shortly." />;
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
      <CommerceHeader stage="Checkout" title="Checkout" description={`${summary.lineCount} ${summary.lineCount === 1 ? 'item' : 'items'} · ${summary.unitCount} ${summary.unitCount === 1 ? 'unit' : 'units'}`} />
      <CheckoutPanel
        cartId={cart.cartId}
        cartVersion={cart.version}
        currency={summary.currency ?? cart.currency}
        cities={cities.state === 'ok' ? cities.data.items : []}
        truncated={cities.state === 'ok' && cities.data.truncated}
        reservationUnavailable={reservationUnavailable}
        initialQuote={initialQuote}
      />
      <p className="mt-6 text-sm leading-6 text-neutral-700">Explore the <Link href="/checkout/recipient-preview" className="font-bold text-brand-red underline">recipient details layout preview</Link>. It is not an order form and does not change this quote.</p>
      <Link href="/cart" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-brand-red hover:underline"><ArrowLeft size={15} />Back to cart</Link>
    </Shell>
  );
}
