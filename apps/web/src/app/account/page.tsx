import Link from 'next/link';
import { Shell } from '@/components/shell';
import { apiFetch } from '@/lib/bff';
export const dynamic = 'force-dynamic';
export default async function Account() {
  let me: any = null;
  try { const res = await apiFetch('/auth/me'); if (res.ok) me = await res.json(); } catch {}
  if (!me) return <Shell><div className="max-w-md mx-auto rounded-2xl border p-8"><h1 className="text-2xl font-bold">Account</h1><p className="mt-2 text-neutral-600">You are not signed in.</p><Link className="mt-4 inline-block rounded-lg bg-brand-red px-5 py-3 text-white" href="/login">Sign in</Link></div></Shell>;
  return <Shell><div className="max-w-2xl rounded-2xl border p-8">
    <h1 className="text-2xl font-bold">Account</h1>
    <p className="mt-2 text-neutral-600">Session is active. Authorization is enforced by the API and database RLS.</p>
    <dl className="mt-6 grid gap-3 text-sm"><div><dt className="font-semibold">User ID</dt><dd className="font-mono">{me.user?.id}</dd></div><div><dt className="font-semibold">Assurance</dt><dd>{me.user?.assurance}</dd></div><div><dt className="font-semibold">Permissions</dt><dd>{(me.permissions ?? []).join(', ') || 'None assigned'}</dd></div></dl>
    <form action="/api/auth/logout" method="post" className="mt-6"><button className="rounded-lg border border-neutral-300 px-5 py-3 font-semibold" type="submit">Sign out</button></form>
  </div></Shell>;
}
