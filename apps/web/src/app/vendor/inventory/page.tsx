import Link from 'next/link';
import { ArrowLeft, Boxes, ClipboardList, ShoppingBag } from 'lucide-react';
import { StockCalculator } from '@/components/stock-calculator';

export default function InventoryPage() {
  return (
    <div className="min-h-screen bg-[#f5f5f7] text-neutral-900">
      <a href="#inventory-main" className="sr-only z-50 rounded bg-white p-3 text-neutral-950 focus:not-sr-only focus:absolute focus:left-4 focus:top-4">Skip to inventory workspace</a>
      <header className="border-b border-neutral-200 bg-white"><div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8"><Link href="/vendor" className="inline-flex items-center gap-3 text-sm font-bold text-neutral-950 hover:text-brand-red"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-red text-white"><ShoppingBag size={21} aria-hidden="true" /></span><span>Get Stoopy <span className="block text-xs font-medium text-neutral-600">Vendor workspace</span></span></Link><Link href="/vendor" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-neutral-700 hover:text-brand-red"><ArrowLeft size={16} aria-hidden="true" /> Dashboard</Link></div></header>
      <main id="inventory-main" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <div className="flex items-start gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-brand-red"><Boxes size={23} aria-hidden="true" /></span><div><p className="text-xs font-bold uppercase tracking-[.16em] text-brand-red">Vendor workspace / Inventory</p><h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Inventory workspace<span className="text-brand-red">.</span></h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">A space for understanding stock and reservations.</p></div></div>
        <div className="mt-6 grid items-start gap-5 lg:grid-cols-2">
          <section aria-labelledby="inventory-records-heading" className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-7"><div className="flex items-center gap-3"><span className="rounded-xl bg-red-50 p-2.5 text-brand-red"><ClipboardList size={20} aria-hidden="true" /></span><div><h2 id="inventory-records-heading" className="text-lg font-bold">Inventory records</h2><p className="mt-1 text-sm text-neutral-600">Store inventory is not connected here.</p></div></div><div className="mt-6 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-5 py-8 text-center"><p className="text-sm font-bold">Stock records unavailable</p><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-neutral-600">This does not mean your inventory is empty. Stock updates and movement history are not available on this page.</p></div><p className="mt-5 text-xs leading-5 text-neutral-600">Live product selection, stock changes and low-stock alerts require a connected, authorized store.</p></section>
          <StockCalculator />
        </div>
      </main>
    </div>
  );
}
