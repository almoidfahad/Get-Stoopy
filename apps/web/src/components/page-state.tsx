import Link from 'next/link';
import { ArrowLeft, ArrowRight, SearchX } from 'lucide-react';

/** Shared recovery layout. Links and actions always point to real routes. */
export function PageState({ title, description, action, children }: {
  title: string;
  description: string;
  action?: 'shop' | 'home';
  children?: React.ReactNode;
}) {
  return (
    <section aria-labelledby="page-state-heading" className="mx-auto grid max-w-4xl overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm md:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0 px-6 py-10 sm:px-10 sm:py-14">
        <p className="section-eyebrow">Get Stoopy</p>
        <h1 id="page-state-heading" className="mt-3 text-3xl font-black tracking-[-.035em] text-neutral-950 sm:text-4xl">{title}<span aria-hidden="true" className="text-brand-red">.</span></h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-neutral-700 sm:text-base">{description}</p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          {children}
          {action === 'shop' ? <Link href="/shop" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand-red px-6 py-3 text-sm font-bold text-white hover:bg-brand-red-hover">Explore the shop <ArrowRight size={16} aria-hidden="true" /></Link> : null}
          <Link href="/" className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold ${action === 'home' ? 'bg-brand-red text-white hover:bg-brand-red-hover' : 'border border-neutral-300 text-neutral-900 hover:border-neutral-900'}`}><ArrowLeft size={16} aria-hidden="true" />Back to home</Link>
        </div>
      </div>
      <div aria-hidden="true" className="hidden items-center justify-center bg-[#faf5ee] p-8 md:flex"><span className="flex h-28 w-28 items-center justify-center rounded-full border border-[#eee4d8] bg-white text-brand-red shadow-sm"><SearchX size={44} strokeWidth={1.4} /></span></div>
    </section>
  );
}
