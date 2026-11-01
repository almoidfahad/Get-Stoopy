import Link from 'next/link';
import { Shell } from '@/components/shell';
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return <Shell><div className="max-w-md mx-auto rounded-2xl border border-neutral-200 p-8">
    <h1 className="text-2xl font-bold">Sign in to Get Stoopy</h1>
    <p className="mt-2 text-neutral-600">You will be redirected to the local Keycloak identity provider. No public admin registration is enabled.</p>
    {sp.error ? <p className="mt-4 text-brand-red text-sm">Sign-in could not be completed. Please try again.</p> : null}
    <a href="/api/auth/login" className="mt-6 inline-block rounded-lg bg-brand-red px-5 py-3 text-white font-semibold">Continue with Keycloak</a>
    <p className="mt-4 text-xs text-neutral-500">Development only. Live payments and production deployment are disabled.</p>
  </div></Shell>;
}
