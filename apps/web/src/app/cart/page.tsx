import Link from 'next/link';
import { CART_ISSUE_MESSAGES, formatMinorUnits, summarizeCart } from '@getstoopy/core';
import { Shell } from '@/components/shell';
import { CartLineControls } from '@/components/cart-controls';
import { getOrCreateCart } from '@/lib/cart';

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
    return (
      <Shell>
        <div className="max-w-xl rounded-2xl border border-neutral-200 bg-neutral-50 p-8">
          <h1 className="text-2xl font-bold">{copy.title}</h1>
          <p className="mt-2 text-neutral-700">{copy.body}</p>
          <div className="mt-5 flex gap-3">
            {result.state === 'sign-in' ? (
              <Link href="/login" className="rounded-lg bg-brand-red px-5 py-3 font-semibold text-white">Sign in</Link>
            ) : null}
            <Link href="/shop" className="rounded-lg border border-neutral-300 px-5 py-3 font-semibold">Browse products</Link>
          </div>
        </div>
      </Shell>
    );
  }

  const cart = result.cart;
  const summary = summarizeCart(cart.items);
  const currency = summary.currency ?? cart.currency;
  const subtotal = summary.subtotalMinor === null ? null : formatMinorUnits(summary.subtotalMinor.toString(), currency);
  const issuesByVariant = new Map<string, string[]>();
  const cartWide: string[] = [];
  for (const issue of summary.issues) {
    const message = CART_ISSUE_MESSAGES[issue.kind];
    if (issue.variantId === null) cartWide.push(message);
    else issuesByVariant.set(issue.variantId, [...(issuesByVariant.get(issue.variantId) ?? []), message]);
  }

  return (
    <Shell>
      <h1 className="text-3xl font-bold">Your cart</h1>
      <p className="mt-1 text-neutral-600">
        {summary.lineCount} {summary.lineCount === 1 ? 'item' : 'items'} · {summary.unitCount}{' '}
        {summary.unitCount === 1 ? 'unit' : 'units'}
      </p>

      {cartWide.length > 0 ? (
        <ul role="alert" className="mt-5 space-y-1 rounded-xl border border-brand-red bg-red-50 p-4 text-sm font-medium text-brand-red">
          {cartWide.map(message => <li key={message}>{message}</li>)}
        </ul>
      ) : null}

      {cart.items.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-neutral-200 bg-neutral-50 p-8">
          <h2 className="text-lg font-semibold">Your cart is empty</h2>
          <p className="mt-2 text-neutral-700">Browse the catalog and add something you like.</p>
          <Link href="/shop" className="mt-4 inline-block rounded-lg bg-brand-red px-5 py-3 font-semibold text-white">
            Browse products
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
          <ul className="divide-y divide-neutral-200 rounded-2xl border border-neutral-200">
            {cart.items.map(item => {
              const unit = formatMinorUnits(item.unitPriceMinor, item.currency);
              const lineTotal = formatMinorUnits(item.lineTotalMinor, item.currency);
              const issues = issuesByVariant.get(item.variantId) ?? [];
              return (
                <li key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <Link href={`/shop/${item.productId}`} className="font-semibold hover:text-brand-red">
                      {item.title}
                    </Link>
                    <p className="text-sm text-neutral-600">{item.storeName}</p>
                    <p className="mt-1 text-sm text-neutral-700">
                      {unit ?? 'Price unavailable'} each · <span className="font-semibold">{lineTotal ?? '—'}</span>
                    </p>
                    {issues.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-sm font-medium text-brand-red">
                        {issues.map(message => <li key={message}>{message}</li>)}
                      </ul>
                    ) : null}
                  </div>
                  <CartLineControls variantId={item.variantId} quantity={item.quantity} version={cart.version} />
                </li>
              );
            })}
          </ul>

          <aside className="h-fit rounded-2xl border border-neutral-200 bg-neutral-50 p-6">
            <h2 className="text-lg font-semibold">Summary</h2>
            <dl className="mt-4 space-y-2 text-sm">
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
            {summary.readyForCheckout ? (
              <Link
                href="/checkout"
                className="mt-5 block w-full rounded-lg bg-brand-red px-5 py-3 text-center font-semibold text-white"
              >
                Continue to checkout
              </Link>
            ) : (
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="mt-5 w-full cursor-not-allowed rounded-lg bg-neutral-300 px-5 py-3 font-semibold text-neutral-600"
              >
                Checkout unavailable
              </button>
            )}
            {summary.issues.length > 0 ? (
              <p className="mt-3 text-sm font-medium text-brand-red">
                Resolve the items flagged above before checkout can be offered.
              </p>
            ) : null}
            <Link href="/shop" className="mt-4 inline-block text-sm font-semibold text-brand-red">Continue shopping</Link>
          </aside>
        </div>
      )}
    </Shell>
  );
}