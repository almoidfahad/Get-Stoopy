import Link from 'next/link';
import { ArrowRight, Search, ShoppingBag, ShoppingCart, UserRound } from 'lucide-react';

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link href="/" aria-label="Get Stoopy home" className="inline-flex shrink-0 items-center gap-2.5">
      <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-brand-red text-white shadow-sm" aria-hidden="true">
        <ShoppingBag size={27} strokeWidth={1.8} />
        <span className="absolute bottom-1.5 text-[12px] font-black leading-none">G</span>
      </span>
      <span className="leading-none">
        <span className={`block text-[21px] font-black tracking-[-.045em] sm:text-[24px] ${inverse ? 'text-white' : 'text-neutral-950'}`}>
          Get <span className="text-brand-red">Stoopy</span>
        </span>
        <span className={`mt-1 block text-[10px] font-semibold tracking-[.01em] ${inverse ? 'text-neutral-300' : 'text-neutral-600'}`}>Shop Smart. Live Better.</span>
      </span>
    </Link>
  );
}

export function Shell({ children, fullWidth = false }: { children: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="sr-only z-50 rounded bg-white p-3 text-neutral-950 focus:not-sr-only focus:absolute focus:left-4 focus:top-4">Skip to content</a>
      <header>
        <div className="bg-neutral-950 text-white">
          <div className="site-container flex h-9 items-center justify-between text-[11px] font-medium tracking-wide sm:text-xs">
            <p className="truncate text-neutral-300">A marketplace made for everyday discoveries.</p>
            <Link href="/login" className="ml-4 shrink-0 text-white hover:text-red-200">Sign in <span aria-hidden="true">/</span> Register</Link>
          </div>
        </div>
        <div className="border-b border-neutral-100 bg-white">
          <div className="site-container flex flex-wrap items-center justify-between gap-x-5 gap-y-3 py-4 md:flex-nowrap md:py-5">
            <Brand />
            <form action="/shop" method="get" role="search" className="order-3 flex h-11 w-full overflow-hidden rounded-full border border-neutral-300 bg-neutral-50 focus-within:border-neutral-500 md:order-none md:mx-auto md:max-w-xl">
              <label htmlFor="site-search" className="sr-only">Search products</label>
              <input id="site-search" type="search" name="q" maxLength={120} placeholder="Search for products, brands and more" className="min-w-0 flex-1 bg-transparent px-5 text-sm text-neutral-900 outline-none placeholder:text-neutral-500" />
              <button type="submit" aria-label="Search" className="flex w-14 items-center justify-center bg-brand-red text-white hover:bg-brand-red-hover"><Search size={19} /></button>
            </form>
            <div className="flex items-center gap-4 sm:gap-6">
              <Link href="/account" aria-label="Account" className="flex items-center gap-2 text-sm font-semibold text-neutral-800 hover:text-brand-red"><UserRound size={22} strokeWidth={1.7} /><span className="hidden lg:inline">Account</span></Link>
              <Link href="/cart" aria-label="Cart" className="flex items-center gap-2 text-sm font-semibold text-neutral-800 hover:text-brand-red"><ShoppingCart size={23} strokeWidth={1.7} /><span className="hidden sm:inline">Cart</span></Link>
            </div>
          </div>
        </div>
        <nav aria-label="Main navigation" className="bg-neutral-950 text-white">
          <div className="site-container flex min-h-12 items-center gap-7 overflow-x-auto whitespace-nowrap text-sm font-semibold sm:gap-10">
            <Link href="/shop" className="flex min-h-12 items-center gap-2 text-red-300 hover:text-white"><ShoppingBag size={16} /> Explore the shop</Link>
            <Link href="/" className="flex min-h-12 items-center hover:text-red-300">Home</Link>
            <Link href="/shop" className="flex min-h-12 items-center hover:text-red-300">Shop</Link>
            <Link href="/cart" className="flex min-h-12 items-center hover:text-red-300">My cart</Link>
            <Link href="/account" className="flex min-h-12 items-center hover:text-red-300">My account</Link>
          </div>
        </nav>
      </header>
      <main id="main-content" tabIndex={-1} className={fullWidth ? 'flex-1' : 'site-container flex-1 py-8 sm:py-12'}>{children}</main>
      <footer className="bg-neutral-950 text-neutral-300">
        <div className="site-container grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr] lg:py-14">
          <div><Brand inverse /><p className="mt-5 max-w-sm text-sm leading-6 text-neutral-400">A thoughtful marketplace for the little things and the big discoveries. Shop smart, live better.</p></div>
          <div><h2 className="text-sm font-bold text-white">Explore</h2><ul className="mt-4 space-y-3 text-sm"><li><Link href="/" className="hover:text-white">Home</Link></li><li><Link href="/shop" className="hover:text-white">Shop all products</Link></li><li><Link href="/cart" className="hover:text-white">Your cart</Link></li></ul></div>
          <div><h2 className="text-sm font-bold text-white">Your account</h2><ul className="mt-4 space-y-3 text-sm"><li><Link href="/login" className="hover:text-white">Sign in</Link></li><li><Link href="/account" className="hover:text-white">Account details</Link></li></ul><Link href="/shop" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-white">Discover the shop <ArrowRight size={15} /></Link></div>
        </div>
        <div className="border-t border-white/10"><div className="site-container flex flex-wrap justify-between gap-3 py-5 text-xs text-neutral-400"><span>© {new Date().getFullYear()} Get Stoopy.</span><span>Shop Smart. Live Better.</span></div></div>
      </footer>
    </div>
  );
}
