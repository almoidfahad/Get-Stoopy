import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Shell } from '@/components/shell';
import { RecipientLayoutPreview } from '@/components/recipient-layout-preview';

export default function RecipientPreviewPage() {
  return (
    <Shell>
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-neutral-600"><Link href="/checkout" className="hover:text-brand-red">Checkout</Link><span aria-hidden="true" className="mx-2 text-neutral-400">/</span><span aria-current="page" className="font-semibold text-neutral-900">Recipient layout preview</span></nav>
      <header className="rounded-2xl bg-[#faf5ee] px-6 py-8 sm:px-9 sm:py-10">
        <p className="section-eyebrow">Checkout / Design preview</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-.035em] sm:text-4xl">Recipient details<span className="text-brand-red">.</span></h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">Explore a possible layout for deliveries to yourself or someone else.</p>
      </header>
      <div role="note" className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-neutral-800"><strong>Layout preview only — not an order form.</strong> Recipient and address fields are disabled; nothing is saved or sent. Actual recipient capture and order placement are not available yet.</div>
      <RecipientLayoutPreview />
      <Link href="/checkout" className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-brand-red hover:underline"><ArrowLeft size={15} aria-hidden="true" />Back to checkout</Link>
    </Shell>
  );
}
