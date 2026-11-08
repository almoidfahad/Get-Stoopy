import Link from 'next/link';
import { ArrowLeft, ShoppingBag } from 'lucide-react';
import { Shell } from '@/components/shell';

type Stage = 'Cart' | 'Checkout';

/** Shared navigation and page heading for the cart and quote flow. */
export function CommerceHeader({ stage, title, description }: { stage: Stage; title: string; description?: string }) {
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
        <Link href="/shop" className="hover:text-brand-red">Shop</Link><span aria-hidden="true" className="text-neutral-400">/</span>
        {stage === 'Checkout' ? <><Link href="/cart" className="hover:text-brand-red">Cart</Link><span aria-hidden="true" className="text-neutral-400">/</span></> : null}
        <span aria-current="page" className="font-semibold text-neutral-900">{stage}</span>
      </nav>
      <header className="rounded-2xl bg-[#faf5ee] px-6 py-7 sm:px-9 sm:py-9">
        <p className="section-eyebrow">Your shopping journey</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-.035em] text-neutral-950 sm:text-4xl">{title}</h1>
        {description ? <p className="mt-2 text-sm leading-6 text-neutral-600">{description}</p> : null}
      </header>
    </>
  );
}

export function CommerceNotice({ stage, title, body, signIn = false, retry = false }: { stage: Stage; title: string; body: string; signIn?: boolean; retry?: boolean }) {
  const backHref = stage === 'Cart' ? '/shop' : '/cart';
  const backLabel = stage === 'Cart' ? 'Browse products' : 'Back to cart';
  return (
    <Shell>
      <CommerceHeader stage={stage} title={stage === 'Cart' ? 'Your cart' : 'Checkout'} />
      <section className="mt-8 max-w-2xl rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-8 sm:p-10" aria-labelledby="notice-title">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand-red"><ShoppingBag size={23} aria-hidden="true" /></span>
        <h2 id="notice-title" className="mt-4 text-xl font-bold text-neutral-950">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-700">{body}</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {signIn ? <Link href="/login" className="inline-flex min-h-12 items-center rounded-full bg-brand-red px-6 py-3 text-sm font-bold text-white hover:bg-brand-red-hover">Sign in</Link> : null}
          {retry ? <a href={stage === 'Cart' ? '/cart' : '/checkout'} className="inline-flex min-h-12 items-center rounded-full bg-brand-red px-6 py-3 text-sm font-bold text-white hover:bg-brand-red-hover">Try again</a> : null}
          <Link href={backHref} className="inline-flex min-h-12 items-center gap-2 rounded-full border border-neutral-300 bg-white px-5 py-3 text-sm font-bold hover:border-neutral-900"><ArrowLeft size={15} aria-hidden="true" />{backLabel}</Link>
        </div>
        {stage === 'Checkout' ? <p className="mt-5 text-sm leading-6 text-neutral-700">Explore the <Link href="/checkout/recipient-preview" className="font-bold text-brand-red underline">recipient details layout preview</Link>. It is not an order form.</p> : null}
      </section>
    </Shell>
  );
}
