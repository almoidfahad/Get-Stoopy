import Link from 'next/link';
import { ArrowLeft, ArrowRight, CircleUserRound, ShoppingBag, Sparkles } from 'lucide-react';
import { Shell } from '@/components/shell';
import { webConfig } from '@/lib/config';

// Configuration is checked at request time, not at build time. This only checks
// required settings, not provider connectivity or a successful sign-in.
export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  let configured = false;
  try { webConfig(); configured = true; } catch { /* Do not expose configuration details. */ }
  return (
    <Shell fullWidth>
      <div className="site-container py-8 sm:py-12 lg:py-16">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-brand-red"><ArrowLeft size={16} aria-hidden="true" /> Back to home</Link>
        <div className="mt-6 grid overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-[0_16px_45px_rgba(25,20,20,0.06)] lg:grid-cols-2">
          <section aria-labelledby="login-heading" className="flex items-center p-7 sm:p-10 lg:order-2 lg:p-14">
            <div className="mx-auto w-full max-w-md">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-brand-red"><CircleUserRound size={28} strokeWidth={1.5} aria-hidden="true" /></span>
              <p className="mt-6 text-xs font-bold uppercase tracking-[.2em] text-brand-red">Your Get Stoopy account</p>
              <h1 id="login-heading" className="mt-2 text-3xl font-black tracking-[-.035em] sm:text-4xl">Welcome back<span className="text-brand-red">.</span></h1>
              <p className="mt-4 text-sm leading-6 text-neutral-600">Sign in to access your account and continue where you left off.</p>
              {!configured ? (
                <div role="status" className="mt-5 rounded-xl border border-neutral-300 bg-neutral-50 p-4 text-sm leading-6 text-neutral-800">
                  <p className="font-bold">Sign-in is not available yet</p>
                  <p className="mt-1">Account sign-in is not configured for this site. Please check back later.</p>
                </div>
              ) : (
                <>
                  {sp.error ? <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-brand-red"><p className="font-bold">{sp.error === 'unavailable' ? 'Sign-in service unavailable' : 'Sign-in could not be completed'}</p><p className="mt-1">{sp.error === 'unavailable' ? 'The sign-in service could not be reached or is not configured. Please try again later.' : 'Please try again. If the problem continues, return to the shop and try later.'}</p></div> : null}
                  <a href="/api/auth/login" className="mt-7 flex min-h-12 items-center justify-center gap-3 rounded-full bg-brand-red px-6 py-3 text-sm font-bold text-white hover:bg-brand-red-hover">Continue to sign in <ArrowRight size={17} aria-hidden="true" /></a>
                  <p className="mt-4 text-center text-xs leading-5 text-neutral-600">You’ll continue to the sign-in service to access your account.</p>
                </>
              )}
              <Link href="/shop" className="mt-4 flex min-h-11 items-center justify-center text-sm font-bold text-neutral-700 underline underline-offset-4 hover:text-brand-red">Continue browsing</Link>
              <div className="mt-7 grid gap-4 border-t border-neutral-200 pt-7 sm:grid-cols-2"><div className="flex gap-3"><ShoppingBag className="shrink-0 text-brand-red" size={21} aria-hidden="true" /><div><p className="text-sm font-bold">Discover more</p><p className="mt-1 text-xs leading-5 text-neutral-600">Explore your marketplace.</p></div></div><div className="flex gap-3"><Sparkles className="shrink-0 text-brand-red" size={21} aria-hidden="true" /><div><p className="text-sm font-bold">All in one place</p><p className="mt-1 text-xs leading-5 text-neutral-600">Return to your account when sign-in is available.</p></div></div></div>
            </div>
          </section>
          <section aria-label="Welcome to Get Stoopy" className="relative flex min-h-[250px] items-end overflow-hidden bg-[#eee1d2] lg:order-1 lg:min-h-[600px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/storefront-hero.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-left" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
            <div className="relative max-w-md p-8 text-white sm:p-10"><p className="text-xs font-bold uppercase tracking-[.2em] text-red-200">Welcome to Get Stoopy</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Your next discovery starts here.</h2><p className="mt-3 text-sm leading-6 text-neutral-200">Shop Smart. Live Better.</p></div>
          </section>
        </div>
      </div>
    </Shell>
  );
}
