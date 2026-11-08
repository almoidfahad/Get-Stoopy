import Link from 'next/link';
import { ArrowLeft, Shield, ShoppingBag } from 'lucide-react';
import { AdminReviewPreview } from '@/components/admin-review-preview';

export default function ReviewPreviewPage() {
  return <div className="min-h-screen bg-[#f5f5f7] text-neutral-900">
    <a href="#review-preview-main" className="sr-only z-50 rounded bg-white p-3 text-neutral-950 focus:not-sr-only focus:absolute focus:left-4 focus:top-4">Skip to review preview</a>
    <header className="border-b border-neutral-200 bg-white"><div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8"><Link href="/admin" className="inline-flex items-center gap-3 text-sm font-bold hover:text-brand-red"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-red text-white"><ShoppingBag size={21} aria-hidden="true" /></span><span>Get Stoopy <span className="block text-xs font-medium text-neutral-600">Admin workspace</span></span></Link><Link href="/admin" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-neutral-700 hover:text-brand-red"><ArrowLeft size={16} aria-hidden="true" /> Dashboard</Link></div></header>
    <main id="review-preview-main" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10"><div className="flex items-start gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-brand-red"><Shield size={23} aria-hidden="true" /></span><div><p className="text-xs font-bold uppercase tracking-[.16em] text-brand-red">Admin workspace / Design preview</p><h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Explore review layouts<span className="text-brand-red">.</span></h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">See possible layouts for product and identity review.</p></div></div>
      <div role="note" className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-neutral-800"><strong>Layout preview only — not an admin tool.</strong> It does not load records, verify access or make review decisions. All decision controls are disabled.</div><AdminReviewPreview />
    </main>
  </div>;
}
