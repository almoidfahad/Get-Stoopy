import Link from 'next/link';
import { ArrowLeft, Package, ShoppingBag } from 'lucide-react';
import { ProductPreviewEditor } from '@/components/product-preview-editor';

export default function ProductPreviewPage() {
  return (
    <div className="min-h-screen bg-[#f5f5f7] text-neutral-900">
      <a href="#preview-main" className="sr-only z-50 rounded bg-white p-3 text-neutral-950 focus:not-sr-only focus:absolute focus:left-4 focus:top-4">Skip to product preview</a>
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/vendor" className="inline-flex items-center gap-3 text-sm font-bold text-neutral-950 hover:text-brand-red"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-red text-white"><ShoppingBag size={21} aria-hidden="true" /></span><span>Get Stoopy <span className="block text-xs font-medium text-neutral-600">Vendor workspace</span></span></Link>
          <Link href="/vendor" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-neutral-700 hover:text-brand-red"><ArrowLeft size={16} aria-hidden="true" /> Dashboard</Link>
        </div>
      </header>
      <main id="preview-main" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <div className="flex items-start gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-brand-red"><Package size={23} aria-hidden="true" /></span><div><p className="text-xs font-bold uppercase tracking-[.16em] text-brand-red">Vendor workspace / Product preview</p><h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Explore a product layout<span className="text-brand-red">.</span></h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">Try the basic product details and see how they fit together.</p></div></div>
        <div role="note" className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-neutral-800"><strong>Preview only — nothing is saved or published.</strong> Your entries stay on this page and are lost when you reload or leave. Do not enter sensitive information.</div>
        <ProductPreviewEditor />
        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6" aria-labelledby="options-link-heading"><h2 id="options-link-heading" className="text-lg font-bold">Product options</h2><p className="mt-2 text-sm leading-6 text-neutral-600">Explore a separate option and price layout. It does not create catalog variants.</p><Link href="/vendor/variants-preview" className="mt-4 inline-flex min-h-11 items-center rounded-full border border-neutral-300 px-5 py-2 text-sm font-bold hover:border-neutral-900">View option layout preview</Link></section>
      </main>
    </div>
  );
}
