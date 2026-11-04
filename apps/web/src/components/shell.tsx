import Link from 'next/link';
export function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex flex-col">
    <header className="bg-neutral-950 text-white">
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold">Get <span className="text-brand-red">Stoopy</span></Link>
        <nav aria-label="Main" className="flex gap-4 text-sm"><Link href="/shop">Shop</Link><Link href="/account">Account</Link><Link href="/login">Login</Link></nav>
      </div>
    </header>
    <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-10">{children}</main>
    <footer className="bg-neutral-950 text-neutral-300 text-sm"><div className="mx-auto max-w-6xl px-4 py-6">Shop Smart. Live Better. Development foundation only.</div></footer>
  </div>;
}
