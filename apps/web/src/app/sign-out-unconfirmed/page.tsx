import Link from 'next/link';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import { Shell } from '@/components/shell';

export const metadata = { title: 'Sign-out status | Get Stoopy', robots: { index: false, follow: false } };

// This recovery screen deliberately does not call the account service: the
// warning must remain available while that service is down or unresponsive.
export default function SignOutUnconfirmed() {
  return (
    <Shell>
      <section aria-labelledby="signout-heading" className="max-w-2xl rounded-2xl border border-red-200 bg-red-50 p-6 sm:p-8">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-brand-red"><CircleAlert size={27} aria-hidden="true" /></span>
        <p className="section-eyebrow mt-5">Sign-out status</p>
        <h1 id="signout-heading" className="mt-2 text-2xl font-black tracking-tight text-neutral-950 sm:text-3xl">Server sign-out could not be confirmed</h1>
        <p className="mt-4 text-sm leading-6 text-neutral-800">If you just signed out, this browser was asked to clear its Get Stoopy session cookie. The server session may still be active until it expires or is revoked.</p>
        <p className="mt-3 text-sm leading-6 text-neutral-800">Your sign-in provider or other devices may also remain signed in. On a shared device, check the sign-in provider’s sign-out options; closing the browser alone may not sign you out there.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/account" className="inline-flex min-h-12 items-center rounded-full bg-brand-red px-6 py-3 text-sm font-bold text-white hover:bg-brand-red-hover">Go to account</Link>
          <Link href="/shop" className="inline-flex min-h-12 items-center gap-2 rounded-full border border-neutral-300 bg-white px-6 py-3 text-sm font-bold hover:border-neutral-900"><ArrowLeft size={16} aria-hidden="true" />Browse products</Link>
        </div>
      </section>
    </Shell>
  );
}
