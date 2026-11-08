import Link from 'next/link';
import { ArrowLeft, ClipboardList, Clock3, PackageCheck, ShoppingBag } from 'lucide-react';

const stages = [
  { title: 'Awaiting vendor', description: 'An order may be accepted with a preparation estimate or rejected with a reason.', Icon: ClipboardList },
  { title: 'Preparing', description: 'Preparation starts through a separate vendor action after acceptance.', Icon: Clock3 },
  { title: 'Ready for pickup', description: 'Readiness requires a manual vendor confirmation; a timer cannot confirm it.', Icon: PackageCheck },
];

/** Public, static layout only. It does not load or authorize access to real orders. */
export default function VendorOrdersPage() {
  return (
    <div className="min-h-screen bg-[#f5f5f7] text-neutral-900">
      <a href="#orders-main" className="sr-only z-50 rounded bg-white p-3 text-neutral-950 focus:not-sr-only focus:absolute focus:left-4 focus:top-4">Skip to orders workspace</a>
      <header className="border-b border-neutral-200 bg-white"><div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8"><Link href="/vendor" className="inline-flex items-center gap-3 text-sm font-bold text-neutral-950 hover:text-brand-red"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-red text-white"><ShoppingBag size={21} aria-hidden="true" /></span><span>Get Stoopy <span className="block text-xs font-medium text-neutral-600">Vendor workspace</span></span></Link><Link href="/vendor" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-neutral-700 hover:text-brand-red"><ArrowLeft size={16} aria-hidden="true" /> Dashboard</Link></div></header>
      <main id="orders-main" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <div className="flex items-start gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-brand-red"><ClipboardList size={23} aria-hidden="true" /></span><div><p className="text-xs font-bold uppercase tracking-[.16em] text-brand-red">Vendor workspace / Orders</p><h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Orders workspace<span className="text-brand-red">.</span></h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">A preview of the store order workspace and vendor preparation stages.</p></div></div>
        <div role="note" className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-neutral-800"><strong>Layout preview only.</strong> Real orders, store selection and order actions are not connected here. No order data is displayed or changed.</div>
        <section aria-labelledby="orders-heading" className="mt-6 min-w-0 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="orders-heading" className="text-lg font-bold">Store orders</h2><p className="mt-1 text-sm leading-6 text-neutral-600">Order records are unavailable in this layout.</p></div><span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-700">Not connected</span></div>
          <div role="region" aria-label="Orders table, scroll horizontally if needed" tabIndex={0} className="mt-5 overflow-x-auto rounded-xl border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-red-300">
            <table className="w-full min-w-[32rem] text-left text-sm"><caption className="sr-only">Store orders: records are not connected</caption><thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-600"><tr><th scope="col" className="px-4 py-3">Order</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3">Amount</th><th scope="col" className="px-4 py-3">Placed</th></tr></thead><tbody><tr><td colSpan={4} className="px-5 py-10 text-center"><p className="font-bold text-neutral-800">Order records unavailable</p><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-neutral-600">This does not mean there are no orders. A store-scoped connection is required before records can be shown.</p></td></tr></tbody></table>
          </div>
          <p className="mt-4 text-xs leading-5 text-neutral-600">Search, filtering, order details and vendor actions are not available on this page yet.</p>
        </section>
        <section aria-labelledby="stages-heading" className="mt-6"><div><h2 id="stages-heading" className="text-lg font-bold">Vendor preparation stages</h2><p className="mt-1 text-sm leading-6 text-neutral-600">Process guidance only—not the status of an actual order. Rejection is an alternative to acceptance.</p></div><ol className="mt-4 grid gap-4 md:grid-cols-3">{stages.map(({ title, description, Icon }, index) => <li key={title} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="rounded-xl bg-red-50 p-2.5 text-brand-red"><Icon size={20} aria-hidden="true" /></span><span className="text-xs font-semibold text-neutral-500">Stage {index + 1}</span></div><h3 className="mt-4 text-base font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-neutral-600">{description}</p></li>)}</ol><p className="mt-4 text-xs leading-5 text-neutral-600">Additional delivery, cancellation and exception states are not shown in this guidance.</p></section>
      </main>
    </div>
  );
}
