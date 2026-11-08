import Link from 'next/link';
import { ArrowLeft, ArrowRight, CircleUserRound, ShoppingBag, Sparkles } from 'lucide-react';
import { Shell } from '@/components/shell';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return (
    <Shell fullWidth>
      <div className="site-container py-8 sm:py-12 lg:py-16">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-brand-red"><ArrowLeft size={16} /> Back to home</Link>
        <div className="mt-6 grid overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-[0_16px_45px_rgba(25,20,20,0.06)] lg:grid-cols-2">
          <section className="relative flex min-h-[250px] items-end overflow-hidden bg-[#eee1d2] lg:min-h-[600px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/storefront-hero.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-left" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
            <div className="relative max-w-md p-8 text-white sm:p-10"><p className="text-xs font-bold uppercase tracking-[.2em] text-red-200">Welcome to Get Stoopy</p><h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Your next discovery starts here.</h1><p className="mt-3 text-sm leading-6 text-neutral-200">Shop Smart. Live Better.</p></div>
          </section>
          <section aria-labelledby="login-heading" className="flex items-center p-7 sm:p-10 lg:p-14">
            <div className="mx-auto w-full max-w-md">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-brand-red"><CircleUserRound size={28} strokeWidth={1.5} /></span>
              <p className="mt-6 text-xs font-bold uppercase tracking-[.2em] text-brand-red">Your Get Stoopy account</p>
              <h2 id="login-heading" className="mt-2 text-3xl font-black tracking-[-.035em] sm:text-4xl">Welcome back<span className="text-brand-red">.</span></h2>
              <p className="mt-4 text-sm leading-6 text-neutral-600">Sign in to access your account and continue where you left off.</p>
              {sp.error ? <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-brand-red">Sign-in could not be completed. Please try again.</p> : null}
              <a href="/api/auth/login" className="mt-7 flex min-h-12 items-center justify-center gap-3 rounded-full bg-brand-red px-6 py-3 text-sm font-bold text-white hover:bg-brand-red-hover">Continue to sign in <ArrowRight size={17} /></a>
              <p className="mt-4 text-center text-xs leading-5 text-neutral-500">You’ll continue to the configured sign-in service to access your account.</p>
              <div className="mt-9 grid gap-4 border-t border-neutral-200 pt-7 sm:grid-cols-2"><div className="flex gap-3"><ShoppingBag className="shrink-0 text-brand-red" size={21} /><div><p className="text-sm font-bold">Discover more</p><p className="mt-1 text-xs leading-5 text-neutral-500">Explore your marketplace.</p></div></div><div className="flex gap-3"><Sparkles className="shrink-0 text-brand-red" size={21} /><div><p className="text-sm font-bold">All in one place</p><p className="mt-1 text-xs leading-5 text-neutral-500">Your account, ready for you.</p></div></div></div>
            </div>
          </section>
        </div>
      </div>
    </Shell>
  );
}
