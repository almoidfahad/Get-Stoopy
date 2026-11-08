import Link from 'next/link';
import { Menu, ShoppingBag } from 'lucide-react';

const links = [
  { href: '/', label: 'Home' },
  { href: '/shop', label: 'Shop' },
  { href: '/cart', label: 'My cart' },
  { href: '/account', label: 'My account' },
];

/** Native disclosure keeps the small-screen menu usable even before JavaScript loads. */
export function StorefrontNavigation() {
  return (
    <nav aria-label="Main navigation" className="storefront-navigation bg-neutral-950 text-white">
      <div className="site-container">
        <div className="hidden min-h-12 items-center gap-7 whitespace-nowrap text-sm font-semibold sm:flex sm:gap-10">
          <Link href="/shop" className="flex min-h-12 items-center gap-2 text-red-300 hover:text-white"><ShoppingBag size={16} aria-hidden="true" /> Explore the shop</Link>
          {links.map(link => <Link key={link.href} href={link.href} className="flex min-h-12 items-center hover:text-red-300">{link.label}</Link>)}
        </div>
        <details className="group sm:hidden">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2"><Menu size={19} aria-hidden="true" /> Menu</span>
            <span aria-hidden="true" className="text-xs text-neutral-300 group-open:hidden">Open</span>
            <span aria-hidden="true" className="hidden text-xs text-neutral-300 group-open:inline">Close</span>
          </summary>
          <ul className="border-t border-white/15 pb-2">
            {links.map(link => <li key={link.href}><Link href={link.href} className="flex min-h-12 items-center border-b border-white/10 px-1 text-sm font-semibold hover:text-red-300">{link.label}</Link></li>)}
          </ul>
        </details>
      </div>
    </nav>
  );
}
