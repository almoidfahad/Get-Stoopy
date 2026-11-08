import Link from 'next/link';
import { Activity, ArrowRight, BarChart3, Bike, Boxes, CircleDollarSign, ClipboardList, Globe2, LayoutDashboard, Package, Settings, Shield, ShoppingBag, Store, Tags, Users, WalletCards } from 'lucide-react';
import { apiFetch } from '@/lib/bff';

export const dynamic = 'force-dynamic';

type SessionState = 'signed-out' | 'unavailable' | 'session';

/** A session check is not an admin authorization or a scope check. */
async function accountSession(): Promise<SessionState> {
  try {
    const response = await apiFetch('/auth/me');
    if (response.status === 401) return 'signed-out';
    if (!response.ok) return 'unavailable';
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object') return 'unavailable';
    const session = data as { user?: { id?: unknown } };
    if (!session.user || typeof session.user.id !== 'string' || !session.user.id) return 'unavailable';
    return 'session';
  } catch {
    return 'unavailable';
  }
}

const modules = [
  { label: 'Orders', Icon: ClipboardList },
  { label: 'Customers', Icon: Users },
  { label: 'Vendors', Icon: Store },
  { label: 'Riders', Icon: Bike },
  { label: 'Products', Icon: Package },
  { label: 'Categories', Icon: Tags },
  { label: 'Finance & payouts', Icon: WalletCards },
  { label: 'Reports', Icon: BarChart3 },
  { label: 'Settings', Icon: Settings },
  { label: 'Security', Icon: Shield },
];

function SidebarContent() {
  return (
    <>
      <Link href="/" className="flex items-center gap-3 px-5 py-6" aria-label="Get Stoopy home">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-red text-white"><ShoppingBag size={24} aria-hidden="true" /></span>
        <span><span className="block text-xl font-black tracking-tight text-white">Get <span className="text-red-300">Stoopy</span></span><span className="mt-1 block text-[10px] font-semibold text-neutral-400">Shop Smart. Live Better.</span></span>
      </Link>
      <div className="mx-4 rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-xs font-bold uppercase tracking-[.15em] text-neutral-400">Workspace</p><p className="mt-1 text-sm font-bold text-white">Admin dashboard</p></div>
      <nav aria-label="Admin workspace" className="mt-5 px-3 pb-5">
        <Link href="/admin" aria-current="page" className="flex min-h-11 items-center gap-3 rounded-xl bg-brand-red px-3 py-2.5 text-sm font-bold text-white"><LayoutDashboard size={18} aria-hidden="true" />Dashboard</Link>
        <Link href="/admin/review-preview" className="mt-2 flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-neutral-200 hover:bg-white/10 hover:text-white"><Shield size={18} aria-hidden="true" />Review layout preview</Link>
        <p className="px-3 pb-1 pt-5 text-[10px] font-bold uppercase tracking-[.15em] text-neutral-400">Modules not yet available</p>
        <ul>{modules.map(({ label, Icon }) => <li key={label} className="flex min-h-10 items-center gap-3 px-3 py-2 text-sm text-neutral-400"><Icon size={18} aria-hidden="true" /><span>{label}</span></li>)}</ul>
      </nav>
    </>
  );
}

const metrics = [
  { title: 'Total orders', Icon: ShoppingBag },
  { title: 'Total customers', Icon: Users },
  { title: 'Total vendors', Icon: Store },
  { title: 'Total riders', Icon: Bike },
  { title: 'Total revenue', Icon: CircleDollarSign },
];

function EmptyPanel({ title, description, icon: Icon, className = '' }: { title: string; description: string; icon: typeof Activity; className?: string }) {
  return <section className={`min-w-0 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm ${className}`}><div className="flex items-center gap-3"><Icon size={20} className="text-brand-red" aria-hidden="true" /><h2 className="text-base font-bold text-neutral-950">{title}</h2></div><div className="mt-5 flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-5 py-6 text-center"><p className="text-sm font-semibold text-neutral-700">Not available yet</p><p className="mt-1 max-w-sm text-xs leading-5 text-neutral-600">{description}</p></div></section>;
}

export default async function AdminDashboard() {
  const state = await accountSession();
  const message = state === 'signed-out'
    ? { title: 'Sign in to your account', body: 'Sign in to your account. Admin permissions and geographic scope are not checked by this layout.' }
    : state === 'session'
      ? { title: 'Account session found', body: 'This layout does not verify admin permissions or geographic scope. Admin data and tools are not connected.' }
      : { title: 'Account session could not be checked', body: 'The account service is unavailable or not configured. Admin access has not been verified.' };

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-neutral-900">
      <a href="#admin-main" className="sr-only z-50 rounded bg-white p-3 text-neutral-950 focus:not-sr-only focus:absolute focus:left-4 focus:top-4">Skip to dashboard</a>
      <div className="lg:grid lg:min-h-screen lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden bg-neutral-950 lg:block"><SidebarContent /></aside>
        <div className="min-w-0">
          <header className="border-b border-neutral-200 bg-white">
            <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-brand-red"><Shield size={20} aria-hidden="true" /></span><div><p className="text-xs font-semibold text-neutral-500">Get Stoopy</p><p className="text-sm font-bold text-neutral-950">Admin workspace</p></div></div><div className="flex items-center gap-4 text-sm font-semibold"><Link href="/account" className="text-neutral-700 hover:text-brand-red">Account</Link><Link href="/shop" className="text-brand-red hover:underline">View shop</Link></div></div>
            <details className="border-t border-neutral-100 bg-neutral-950 text-white lg:hidden"><summary className="cursor-pointer px-4 py-3 text-sm font-bold">Workspace menu</summary><SidebarContent /></details>
          </header>
          <main id="admin-main" tabIndex={-1} className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-100 bg-[#fff3f2] px-5 py-6 sm:px-7"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-brand-red">Admin workspace</p><h1 className="mt-2 text-2xl font-black tracking-tight text-neutral-950 sm:text-3xl">Dashboard overview<span className="text-brand-red">.</span></h1><p className="mt-2 text-sm leading-6 text-neutral-600">A workspace for marketplace oversight.</p></div><Link href="/account" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-red-200 bg-white px-5 py-2 text-sm font-bold text-brand-red hover:border-brand-red">Your account <ArrowRight size={16} /></Link></div>
            <section aria-labelledby="access-heading" className="mt-5 rounded-2xl border border-neutral-200 bg-white px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 id="access-heading" className="text-sm font-bold text-neutral-950">{message.title}</h2><p className="mt-1 text-sm leading-6 text-neutral-600">{message.body}</p></div>{state === 'signed-out' ? <Link href="/login" className="inline-flex min-h-11 items-center rounded-full bg-brand-red px-5 py-2 text-sm font-bold text-white hover:bg-brand-red-hover">Sign in</Link> : state === 'unavailable' ? <Link href="/admin" className="inline-flex min-h-11 items-center rounded-full border border-neutral-300 px-5 py-2 text-sm font-bold hover:border-neutral-900">Try again</Link> : null}</div></section>
            <section aria-labelledby="overview-heading" className="mt-7"><div className="mb-4 flex flex-wrap items-end justify-between gap-2"><h2 id="overview-heading" className="text-xl font-bold tracking-tight">Overview</h2><p className="text-xs text-neutral-600">Dashboard metrics are not connected.</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{metrics.map(({ title, Icon }) => <article key={title} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-brand-red"><Icon size={21} aria-hidden="true" /></span><div><h3 className="text-sm font-semibold text-neutral-600">{title}</h3><p className="mt-2 text-base font-bold text-neutral-800">Unavailable</p></div></div></article>)}</div></section>
            <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3"><EmptyPanel title="Sales overview" description="Scoped sales reporting is not connected to this dashboard." icon={BarChart3} /><EmptyPanel title="Order status" description="Scoped order status reporting is not connected to this dashboard." icon={Boxes} /><EmptyPanel title="Regional overview" description="Geographic reporting is not connected to this dashboard." icon={Globe2} /><EmptyPanel title="Recent orders" description="Scoped orders are not connected to this dashboard." icon={ClipboardList} /><EmptyPanel title="Top categories" description="Category reporting is not connected to this dashboard." icon={Tags} /><EmptyPanel title="System health" description="Health monitoring is not connected to this dashboard; no service status is shown." icon={Activity} /></div>
            <section aria-labelledby="actions-heading" className="mt-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"><h2 id="actions-heading" className="text-base font-bold">Admin actions</h2><p className="mt-2 text-sm leading-6 text-neutral-600">Management, reports and security tools are not available here yet.</p><Link href="/admin/review-preview" className="mt-4 inline-flex min-h-11 items-center rounded-full border border-neutral-300 px-5 py-2 text-sm font-bold hover:border-neutral-900">Explore review layout preview</Link></section>
            <p className="mt-6 text-xs leading-5 text-neutral-600">Dashboard layout only. No admin permissions or geographic scope are granted or verified here.</p>
          </main>
        </div>
      </div>
    </div>
  );
}
