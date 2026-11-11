import Link from 'next/link';
import { ArrowRight, Baby, Headphones, Heart, House, PackageSearch, Shirt, ShoppingBag, Sparkles, Watch } from 'lucide-react';
import { Shell } from '@/components/shell';
import { ProductCard } from '@/components/product-card';
import { fetchProducts } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

const departments = [
  { name: 'Electronics', icon: Headphones, q: 'electronics' },
  { name: 'Fashion', icon: Shirt, q: 'fashion' },
  { name: 'Home & living', icon: House, q: 'home' },
  { name: 'Beauty & care', icon: Sparkles, q: 'beauty' },
  { name: 'Accessories', icon: Watch, q: 'accessories' },
  { name: 'Kids & toys', icon: Baby, q: 'toys' },
];

export default async function Home() {
  const products = await fetchProducts({});
  const items = products.state === 'ok' ? products.data.items.slice(0, 5) : [];
  const collectionNotice = products.state === 'unavailable' || products.state === 'not-found'
    ? { title: 'The collection is temporarily unavailable', body: 'We couldn’t load products right now. Please try again shortly.', action: 'Visit the shop' }
    : products.state === 'not-configured'
      ? { title: 'Our shop is getting ready', body: 'Products aren’t available to browse here yet. Please check back later.', action: 'Visit the shop' }
      : { title: 'No products to show yet', body: 'There are no published products in the collection right now. Please check back later.', action: 'Visit the shop' };
  return (
    <Shell fullWidth>
      <section aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-[#f6ecdf]">
        <div className="absolute inset-0 hidden bg-cover bg-center md:block" style={{ backgroundImage: "url('/images/home-cover.jpg')" }} aria-hidden="true" />
        <div className="absolute inset-0 hidden bg-gradient-to-r from-transparent via-transparent to-[#fbf4e9]/90 md:block" aria-hidden="true" />
        <div className="site-container relative grid min-h-[460px] items-center md:min-h-[440px] md:grid-cols-2 lg:min-h-[500px]">
          <div className="relative -mx-4 h-56 overflow-hidden sm:-mx-6 sm:h-72 md:invisible md:mx-0 md:h-auto" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/home-cover.jpg" alt="" className="h-full w-full object-cover object-left" />
          </div>
          <div className="py-10 md:col-start-2 md:py-14 md:pl-8 lg:pl-12">
            <p className="mb-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-brand-red"><span className="h-px w-7 bg-brand-red" /> Welcome to Get Stoopy</p>
            <h1 id="hero-title" className="max-w-xl text-4xl font-black leading-[1.08] tracking-[-.045em] text-neutral-950 sm:text-5xl lg:text-[3.9rem]">Shop smart.<br /><span className="text-brand-red">Live better.</span></h1>
            <p className="mt-5 max-w-md text-base leading-7 text-neutral-700 sm:text-lg">A little inspiration for every day. Discover a world of products, all in one place.</p>
            <Link href="/shop" className="mt-7 inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-brand-red px-7 py-3 text-sm font-bold text-white shadow-sm hover:bg-brand-red-hover">Explore the shop <ArrowRight size={17} /></Link>
            <p className="mt-5 text-xs font-medium tracking-wide text-neutral-600">Curated for the way you live.</p>
          </div>
        </div>
      </section>

      <div className="site-container">
        <section aria-labelledby="departments-title" className="border-b border-neutral-200 py-10 sm:py-14">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="section-eyebrow">Find your favorites</p><h2 id="departments-title" className="section-title">Explore by interest<span className="text-brand-red">.</span></h2></div><Link href="/shop" className="inline-flex items-center gap-2 text-sm font-bold text-brand-red hover:text-brand-red-hover">Browse all <ArrowRight size={16} /></Link></div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6 sm:gap-4">
            {departments.map(({ name, icon: Icon, q }) => (
              <Link key={name} href={`/shop?q=${encodeURIComponent(q)}`} className="group rounded-2xl border border-neutral-200 bg-white p-3 text-center transition-colors hover:border-red-200 hover:bg-red-50 sm:p-4" aria-label={`Search for ${name}`}>
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#f8f4ef] text-neutral-800 group-hover:text-brand-red sm:h-16 sm:w-16"><Icon size={27} strokeWidth={1.5} /></span>
                <span className="mt-3 block text-xs font-bold leading-4 text-neutral-800 sm:text-sm">{name}</span>
              </Link>
            ))}
          </div>
        </section>

        <section aria-label="Discover Get Stoopy" className="grid gap-4 py-10 md:grid-cols-3 md:py-12">
          <article className="relative min-h-[190px] overflow-hidden rounded-2xl bg-neutral-950 text-white md:col-span-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/storefront-essentials.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-55" loading="lazy" />
            <div className="absolute inset-0 bg-gradient-to-r from-neutral-950/95 via-neutral-950/70 to-transparent" />
            <div className="relative max-w-sm p-7 sm:p-8"><p className="text-xs font-bold uppercase tracking-[.18em] text-red-200">The everyday edit</p><h2 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">Find something wonderful.</h2><p className="mt-2 text-sm leading-6 text-neutral-200">A little more inspiration for your everyday.</p><Link href="/shop" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-white underline decoration-red-400 underline-offset-4">Discover the shop <ArrowRight size={15} /></Link></div>
          </article>
          <article className="flex min-h-[190px] flex-col justify-between rounded-2xl bg-[#f8f3ec] p-7 sm:p-8"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-brand-red">Made for discovery</p><h2 className="mt-3 text-2xl font-black tracking-tight text-neutral-950">A world of possibilities.</h2><p className="mt-2 text-sm leading-6 text-neutral-600">Explore products from stores in your market.</p></div><Link href="/shop" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-brand-red">Shop products <ArrowRight size={15} /></Link></article>
        </section>

        <section aria-labelledby="collection-title" className="pb-14 pt-2 sm:pb-20">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="section-eyebrow">Our collection</p><h2 id="collection-title" className="section-title">Discover products<span className="text-brand-red">.</span></h2><p className="mt-2 text-sm text-neutral-600">Find your next favorite from our marketplace.</p></div><Link href="/shop" className="inline-flex items-center gap-2 rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-bold hover:border-neutral-900">View all products <ArrowRight size={15} /></Link></div>
          {items.length > 0 ? <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">{items.map(product => <ProductCard key={product.id} product={product} />)}</ul> : (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-6 py-12 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-brand-red"><PackageSearch size={27} strokeWidth={1.5} /></span><h3 className="mt-4 text-lg font-bold">{collectionNotice.title}</h3><p className="mt-2 max-w-md text-sm leading-6 text-neutral-600">{collectionNotice.body}</p><Link href="/shop" className="mt-4 inline-flex min-h-11 items-center text-sm font-bold text-brand-red hover:underline">{collectionNotice.action} <span aria-hidden="true">→</span></Link></div>
          )}
        </section>
      </div>
      <section className="border-y border-[#eee4d8] bg-[#faf5ee]"><div className="site-container grid gap-6 py-7 sm:grid-cols-3"><div className="flex items-center gap-3"><span className="rounded-full bg-white p-3 text-brand-red"><ShoppingBag size={22} /></span><div><h2 className="text-sm font-bold">Discover more</h2><p className="mt-1 text-xs text-neutral-600">Browse products in one place</p></div></div><div className="flex items-center gap-3"><span className="rounded-full bg-white p-3 text-brand-red"><Heart size={22} /></span><div><h2 className="text-sm font-bold">Made for everyday</h2><p className="mt-1 text-xs text-neutral-600">Ideas for the things you love</p></div></div><div className="flex items-center gap-3"><span className="rounded-full bg-white p-3 text-brand-red"><PackageSearch size={22} /></span><div><h2 className="text-sm font-bold">Shop your way</h2><p className="mt-1 text-xs text-neutral-600">Explore at your own pace</p></div></div></div></section>
    </Shell>
  );
}
