import Link from 'next/link';
import { CART_ISSUE_MESSAGES, formatMinorUnits, summarizeCart } from '@getstoopy/core';
import { Shell } from '@/components/shell';
import { CartLineControls } from '@/components/cart-controls';
import { getOrCreateCart } from '@/lib/cart';
import { CommerceHeader, CommerceNotice } from '@/components/commerce-layout';
import { ArrowRight, ShoppingBag } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const result = await getOrCreateCart();

  if (result.state !== 'ok') {
    const copy =
      result.state === 'sign-in'
        ? { title: 'Sign in to view your cart', body: 'Your cart belongs to your account, so you need to be signed in.' }
        : result.state === 'not-configured'
          ? { title: 'Market not configured', body: 'This deployment has no market country set, so carts are unavailable. No demo cart is substituted.' }
          : { title: 'Cart unavailable', body: 'The cart service could not be reached. Please try again shortly.' };
    return <CommerceNotice stage="Cart" title={copy.title} body={copy.body} signIn={result.state === 'sign-in'} />;
  }

  const cart = result.cart;
  const summary = summarizeCart(cart.items);
  const currency = summary.currency ?? cart.currency;
  // A disagreement with the server must not be presented as a settled subtotal.
  const subtotal = summary.subtotalMinor === null || summary.issues.some(issue => issue.kind === 'line-total-mismatch')
    ? null : formatMinorUnits(summary.subtotalMinor.toString(), currency);
  const issuesByVariant = new Map<string, string[]>();
  const cartWide: string[] = [];
  for (const issue of summary.issues) {
    const message = CART_ISSUE_MESSAGES[issue.kind];
    if (issue.variantId === null) cartWide.push(message);
    else issuesByVariant.set(issue.variantId, [...(issuesByVariant.get(issue.variantId) ?? []), message]);
  }

  return (
    <Shell>
      <CommerceHeader stage="Cart" title="Your cart" description={`${summary.lineCount} ${summary.lineCount === 1 ? 'item' : 'items'} · ${summary.unitCount} ${summary.unitCount === 1 ? 'unit' : 'units'}`} />

      {cart.activeQuoteId ? (
        <p className="mt-6 rounded-xl border border-neutral-300 bg-neutral-50 p-4 text-sm leading-6">
          This cart has a reserved quote. Stock availability may reflect that reservation.{' '}
          <Link href="/checkout" className="font-semibold text-brand-red underline">View or release the quote</Link>.
        </p>
      ) : null}

      {cartWide.length > 0 ? (
        <ul role="alert" className="mt-5 space-y-1 rounded-xl border border-brand-red bg-red-50 p-4 text-sm font-medium text-brand-red">
          {cartWide.map(message => <li key={message}>{message}</li>)}
        </ul>
      ) : null}

      {cart.items.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-8 sm:p-10">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand-red"><ShoppingBag size={23} aria-hidden="true" /></span>
          <h2 className="mt-4 text-xl font-bold">Your cart is empty</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-700">Browse the catalog and add something you like.</p>
          <Link href="/shop" className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-full bg-brand-red px-6 py-3 text-sm font-bold text-white hover:bg-brand-red-hover">
            Browse products <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
          <ul className="divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200">
            {cart.items.map(item => {
              const issues = issuesByVariant.get(item.variantId) ?? [];
              const itemIssues = summary.issues.filter(issue => issue.variantId === item.variantId);
              const invalidUnit = itemIssues.some(issue => issue.kind === 'price-invalid' || issue.kind === 'currency-invalid');
              const invalidTotal = invalidUnit || itemIssues.some(issue => issue.kind === 'line-total-mismatch' || issue.kind === 'quantity-invalid');
              const unit = invalidUnit ? null : formatMinorUnits(item.unitPriceMinor, item.currency);
              const lineTotal = invalidTotal ? null : formatMinorUnits(item.lineTotalMinor, item.currency);
              return (
                <li key={item.id} className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
                  <div className="min-w-0">
                    <Link href={`/shop/${item.productId}`} className="font-bold text-neutral-950 hover:text-brand-red">
                      {item.title}
                    </Link>
                    <p className="text-sm text-neutral-600">{item.storeName}</p>
                    <p className="mt-1 text-sm text-neutral-700">
                      {unit ? `${unit} each` : 'Unit price unavailable'} · <span className="font-semibold">{lineTotal ?? 'Line total unavailable'}</span>
                    </p>
                    {issues.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-sm font-medium text-brand-red">
                        {issues.map(message => <li key={message}>{message}</li>)}
                      </ul>
                    ) : null}
                  </div>
                  <CartLineControls variantId={item.variantId} productTitle={item.title} quantity={item.quantity} version={cart.version} />
                </li>
              );
            })}
          </ul>

          <aside className="h-fit rounded-2xl border border-[#eee4d8] bg-[#faf5ee] p-6">
            <h2 className="text-lg font-bold">Cart summary</h2>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd className="font-bold">{subtotal ?? 'Unavailable'}</dd>
              </div>
              <div className="flex justify-between text-neutral-600">
                <dt>Delivery</dt>
                <dd>Not calculated yet</dd>
              </div>
              <div className="flex justify-between text-neutral-600">
                <dt>Total</dt>
                <dd>Not calculated yet</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-neutral-700">
              Checkout can reserve your items and quote a delivery city. Delivery charges, taxes and payment
              are not implemented yet, so no grand total is shown and no money is taken.
            </p>
            {summary.readyForCheckout || cart.activeQuoteId ? (
              <Link
                href="/checkout"
                className="mt-5 block min-h-12 w-full rounded-full bg-brand-red px-5 py-3 text-center font-bold text-white hover:bg-brand-red-hover"
              >
                {cart.activeQuoteId ? 'View reserved quote' : 'Continue to checkout'}
              </Link>
            ) : (
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="mt-5 min-h-12 w-full cursor-not-allowed rounded-full bg-neutral-300 px-5 py-3 font-bold text-neutral-700"
              >
                Checkout unavailable
              </button>
            )}
            {summary.issues.length > 0 ? (
              <p className="mt-3 text-sm font-medium text-brand-red">
                {cart.activeQuoteId ? 'Review or release your quote before requesting another.' : 'Resolve the items flagged above before checkout can be offered.'}
              </p>
            ) : null}
            <Link href="/shop" className="mt-4 inline-block text-sm font-bold text-brand-red hover:underline">Continue shopping</Link>
          </aside>
        </div>
      )}
    </Shell>
  );
}