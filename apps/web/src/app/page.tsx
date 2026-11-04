import Link from 'next/link';
import { Shell } from '@/components/shell';
export default function Home() {
  return <Shell>
    <section className="rounded-2xl bg-neutral-50 p-10 border border-neutral-200">
      <p className="text-brand-red font-semibold">Bangladesh-first marketplace foundation</p>
      <h1 className="mt-3 text-4xl font-bold">Shop Smart. Live Better.</h1>
      <p className="mt-4 max-w-2xl text-neutral-700">Secure API-first foundation with Next.js BFF, NestJS modular monolith, Keycloak OIDC and PostgreSQL/PostGIS row-level security. Commerce features are not live yet.</p>
      <div className="mt-6 flex flex-wrap gap-3"><Link className="rounded-lg bg-brand-red px-5 py-3 text-white font-semibold" href="/shop">Browse products</Link><Link className="rounded-lg border border-neutral-300 px-5 py-3 font-semibold" href="/login">Sign in</Link><Link className="rounded-lg border border-neutral-300 px-5 py-3 font-semibold" href="/account">Account</Link></div>
    </section>
  </Shell>;
}
