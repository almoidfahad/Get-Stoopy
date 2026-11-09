import Link from 'next/link';
import { ArrowRight, CircleUserRound, LogOut, ShoppingBag, ShoppingCart } from 'lucide-react';
import { Shell } from '@/components/shell';
import { apiFetch } from '@/lib/bff';

export const dynamic = 'force-dynamic';

interface AccountDetails {
  user: { id: string; assurance: string };
  permissions: string[];
}

type AccountResult =
  | { state: 'signed-in'; account: AccountDetails }
  | { state: 'signed-out' }
  | { state: 'unavailable' };

/** The session endpoint is the source of truth; never turn a service failure into a sign-out claim. */
async function loadAccount(): Promise<AccountResult> {
  try {
    const response = await apiFetch('/auth/me');
    if (response.status === 401) return { state: 'signed-out' };
    if (!response.ok) return { state: 'unavailable' };
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object') return { state: 'unavailable' };
    const account = data as { user?: { id?: unknown; assurance?: unknown }; permissions?: unknown };
    if (!account.user || typeof account.user.id !== 'string' || !account.user.id ||
        typeof account.user.assurance !== 'string' || !account.user.assurance ||
        !Array.isArray(account.permissions) || !account.permissions.every(permission => typeof permission === 'string')) {
      return { state: 'unavailable' };
    }
    return { state: 'signed-in', account: { user: { id: account.user.id, assurance: account.user.assurance }, permissions: account.permissions } };
  } catch {
    return { state: 'unavailable' };
  }
}

export default async function Account() {
  const result = await loadAccount();
  return (
    <Shell>
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-neutral-600"><Link href="/" className="hover:text-brand-red">Home</Link><span aria-hidden="true" className="mx-2 text-neutral-400">/</span><span aria-current="page" className="font-semibold text-neutral-900">Account</span></nav>
      <header className="rounded-2xl bg-[#faf5ee] px-6 py-8 sm:px-9 sm:py-10">
        <p className="section-eyebrow">Your Get Stoopy account</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-.035em] text-neutral-950 sm:text-4xl">Your account<span className="text-brand-red">.</span></h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-600">A place to access your session and continue shopping.</p>
      </header>

      {result.state !== 'signed-in' ? (
        <section aria-labelledby="account-notice" className="mt-8 max-w-2xl rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-8 sm:p-10">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-brand-red"><CircleUserRound size={28} strokeWidth={1.5} aria-hidden="true" /></span>
          <h2 id="account-notice" className="mt-5 text-xl font-bold text-neutral-950">{result.state === 'signed-out' ? 'Sign in to your account' : 'Account temporarily unavailable'}</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-700">{result.state === 'signed-out' ? 'You are not signed in. Continue to the sign-in service to access your account.' : 'We could not load your account right now. Please try again shortly.'}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {result.state === 'signed-out' ? <Link href="/login" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-brand-red px-6 py-3 text-sm font-bold text-white hover:bg-brand-red-hover">Sign in <ArrowRight size={16} /></Link> : <a href="/account" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-brand-red px-6 py-3 text-sm font-bold text-white hover:bg-brand-red-hover">Try again <ArrowRight size={16} aria-hidden="true" /></a>}
            <Link href="/shop" className="inline-flex min-h-12 items-center rounded-full border border-neutral-300 bg-white px-6 py-3 text-sm font-bold hover:border-neutral-900">Browse products</Link>
          </div>
        </section>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
          <section aria-labelledby="session-heading" className="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8">
            <div className="flex items-start gap-4"><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-brand-red"><CircleUserRound size={28} strokeWidth={1.5} aria-hidden="true" /></span><div><p className="section-eyebrow">Account overview</p><h2 id="session-heading" className="mt-2 text-xl font-bold text-neutral-950">Signed in</h2><p className="mt-2 text-sm leading-6 text-neutral-600">Your session is active. Access to account actions is checked by the service.</p></div></div>
            <dl className="mt-7 grid gap-4 border-t border-neutral-200 pt-6 sm:grid-cols-2">
              <div><dt className="text-xs font-bold uppercase tracking-wide text-neutral-500">User ID</dt><dd className="mt-2 break-all font-mono text-sm text-neutral-900">{result.account.user.id}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wide text-neutral-500">Session assurance</dt><dd className="mt-2 break-words text-sm font-semibold text-neutral-900 [overflow-wrap:anywhere]">{result.account.user.assurance}</dd></div>
            </dl>
            <details className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 p-4"><summary className="cursor-pointer text-sm font-bold text-neutral-900">View access permissions</summary>{result.account.permissions.length ? <ul className="mt-3 space-y-1 break-words text-sm text-neutral-700 [overflow-wrap:anywhere]">{result.account.permissions.map((permission, index) => <li key={`${permission}-${index}`}>{permission}</li>)}</ul> : <p className="mt-3 text-sm text-neutral-600">None assigned</p>}</details>
            <form action="/api/auth/logout" method="post" className="mt-6"><button type="submit" className="inline-flex min-h-12 items-center gap-2 rounded-full border border-neutral-300 px-6 py-3 text-sm font-bold text-neutral-900 hover:border-neutral-900"><LogOut size={16} aria-hidden="true" /> Sign out</button><p className="mt-2 text-sm leading-6 text-neutral-600">This signs out this Get Stoopy session; your sign-in provider or other devices may stay signed in.</p></form>
          </section>
          <aside aria-labelledby="quick-links-heading" className="h-fit rounded-2xl border border-[#eee4d8] bg-[#faf5ee] p-6">
            <h2 id="quick-links-heading" className="text-lg font-bold text-neutral-950">Continue shopping</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-600">Explore the collection or return to your cart.</p>
            <div className="mt-5 grid gap-3"><Link href="/shop" className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm font-bold hover:border-neutral-400"><span className="flex items-center gap-3"><ShoppingBag size={18} className="text-brand-red" aria-hidden="true" />Browse products</span><ArrowRight size={16} aria-hidden="true" /></Link><Link href="/cart" className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm font-bold hover:border-neutral-400"><span className="flex items-center gap-3"><ShoppingCart size={18} className="text-brand-red" aria-hidden="true" />Your cart</span><ArrowRight size={16} aria-hidden="true" /></Link></div>
            <p className="mt-5 border-t border-[#eee4d8] pt-4 text-xs leading-5 text-neutral-600">Profile editing and order history are not available on this page yet.</p>
          </aside>
        </div>
      )}
    </Shell>
  );
}
