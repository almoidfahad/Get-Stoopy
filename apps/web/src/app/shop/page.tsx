import Link from 'next/link';
import { ArrowRight, PackageSearch, Search } from 'lucide-react';
import { Shell } from '@/components/shell';
import { ProductCard } from '@/components/product-card';
import { fetchCategories, fetchProducts } from '@/lib/catalog';
import { isValidShopCursor, normalizeShopQuery } from '@/lib/shop-query';

export const dynamic = 'force-dynamic';

interface ShopSearchParams {
  q?: string;
  categoryId?: string;
  cursor?: string;
}

function shopHref(params: ShopSearchParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.categoryId) search.set('categoryId', params.categoryId);
  if (params.cursor) search.set('cursor', params.cursor);
  const query = search.toString();
  return query ? `/shop?${query}` : '/shop';
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q, categoryId, cursor, issues } = normalizeShopQuery(await searchParams);

  const [products, categories] = await Promise.all([
    fetchProducts({ q, categoryId, cursor }),
    fetchCategories(),
  ]);
  const categoryList = categories.state === 'ok' ? categories.data : [];
  const activeCategory = categoryList.find(category => category.id === categoryId);

  return (
    <Shell>
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-neutral-600">
        <Link href="/" className="hover:text-brand-red">Home</Link><span className="mx-2 text-neutral-400" aria-hidden="true">/</span><span aria-current="page" className="font-semibold text-neutral-900">Shop</span>
      </nav>
      <header className="rounded-2xl bg-[#faf5ee] px-6 py-8 sm:px-9 sm:py-10">
        <p className="section-eyebrow">The Get Stoopy collection</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-.035em] text-neutral-950 sm:text-4xl">Explore the shop<span className="text-brand-red">.</span></h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-600 sm:text-base">Discover published products from stores in your market.</p>
      </header>

      {issues.length > 0 ? <div role="status" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-neutral-800"><p className="font-bold">Some filters were not applied</p><ul className="mt-1 list-disc space-y-1 pl-5">{issues.includes('search-too-long') ? <li>Search terms must be 120 characters or fewer. Shorten your search and try again.</li> : null}{issues.includes('invalid-category') ? <li>The category link was invalid. Choose a category from the available list.</li> : null}{issues.includes('invalid-cursor') ? <li>The page link was invalid. The request was reset to the first page.</li> : null}</ul></div> : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
        <aside aria-label="Shop filters" className="min-w-0">
          <form action="/shop" method="get" role="search">
            <label htmlFor="shop-search" className="block text-sm font-bold text-neutral-900">Search the collection</label>
            <div className="mt-3 flex overflow-hidden rounded-xl border border-neutral-300 bg-white focus-within:border-neutral-600">
              <input id="shop-search" type="search" name="q" defaultValue={q ?? ''} maxLength={120} placeholder="Search products" className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm outline-none" />
              {categoryId ? <input type="hidden" name="categoryId" value={categoryId} /> : null}
              <button type="submit" aria-label="Search the collection" className="flex min-h-12 w-12 shrink-0 items-center justify-center bg-brand-red text-white hover:bg-brand-red-hover"><Search size={19} /></button>
            </div>
          </form>

          {categoryList.length > 0 ? (
            <nav aria-label="Categories" className="mt-7">
              <h2 className="text-sm font-bold text-neutral-900">Categories</h2>
              <div className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:gap-1">
                <Link href={shopHref({ ...(q ? { q } : {}) })} aria-current={categoryId ? undefined : 'page'} className={`rounded-lg px-3 py-2.5 text-sm ${categoryId ? 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100' : 'bg-red-50 font-bold text-brand-red'}`}>All products</Link>
                {categoryList.map(category => (
                  <Link key={category.id} href={shopHref({ categoryId: category.id, ...(q ? { q } : {}) })} aria-current={categoryId === category.id ? 'page' : undefined} className={`rounded-lg px-3 py-2.5 text-sm ${categoryId === category.id ? 'bg-red-50 font-bold text-brand-red' : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'}`}>{category.name}</Link>
                ))}
              </div>
            </nav>
          ) : categories.state === 'unavailable' || categories.state === 'not-found' ? (
            <p className="mt-6 text-sm leading-6 text-neutral-600">Categories are temporarily unavailable.</p>
          ) : null}
        </aside>

        <section aria-labelledby="products-heading" className="min-w-0">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200 pb-5">
            <div><p className="section-eyebrow">Our collection</p><h2 id="products-heading" className="mt-1 text-2xl font-black tracking-tight text-neutral-950">{activeCategory?.name ?? (categoryId ? 'Selected category' : 'All products')}</h2>{q ? <p className="mt-1 text-sm text-neutral-600">Search: “{q}”</p> : null}</div>
            {q || categoryId ? <Link href="/shop" className="text-sm font-bold text-brand-red hover:underline">Clear filters</Link> : null}
          </div>
          <div aria-live="polite">
            {products.state === 'not-configured' ? (
              <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-8">
                <PackageSearch size={28} className="text-brand-red" aria-hidden="true" /><h3 className="mt-4 text-lg font-bold">Market not configured</h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-700">This deployment has no market country set, so there is no catalog to show. Configure <code className="rounded bg-white px-1 py-0.5 font-mono text-sm">MARKET_COUNTRY_ID</code> to browse real published products. No demo products are substituted.</p>
              </div>
            ) : products.state === 'unavailable' || products.state === 'not-found' ? (
              <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-8"><PackageSearch size={28} className="text-brand-red" aria-hidden="true" /><h3 className="mt-4 text-lg font-bold">Catalog unavailable</h3><p className="mt-2 text-sm leading-6 text-neutral-700">The catalog service could not be reached. Please try again shortly.</p><Link href={shopHref({ ...(q ? { q } : {}), ...(categoryId ? { categoryId } : {}), ...(cursor ? { cursor } : {}) })} className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-brand-red hover:underline">Retry <ArrowRight size={15} /></Link></div>
            ) : products.data.items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-8"><PackageSearch size={28} className="text-brand-red" aria-hidden="true" /><h3 className="mt-4 text-lg font-bold">No products found</h3><p className="mt-2 text-sm leading-6 text-neutral-700">{cursor ? 'There are no products on this page.' : q ? `Nothing matched “${q}”.` : categoryId ? 'No published products were found in this category.' : 'No published products are available in this market yet.'}</p>{cursor ? <Link href={shopHref({ ...(q ? { q } : {}), ...(categoryId ? { categoryId } : {}) })} className="mt-4 inline-block text-sm font-bold text-brand-red hover:underline">Back to first page</Link> : q || categoryId ? <Link href="/shop" className="mt-4 inline-block text-sm font-bold text-brand-red hover:underline">Clear filters</Link> : null}</div>
            ) : (
              <><p className="mb-4 text-sm text-neutral-600">Showing {products.data.items.length} {products.data.items.length === 1 ? 'product' : 'products'} on this page.</p><ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">{products.data.items.map(product => <ProductCard key={product.id} product={product} />)}</ul>
                {cursor || products.data.nextCursor ? <nav aria-label="Product pages" className="mt-8 flex flex-wrap items-center gap-3">{cursor ? <Link href={shopHref({ ...(q ? { q } : {}), ...(categoryId ? { categoryId } : {}) })} className="inline-flex min-h-12 items-center rounded-full border border-neutral-300 px-6 py-3 text-sm font-bold hover:border-neutral-900">First page</Link> : null}{products.data.nextCursor && isValidShopCursor(products.data.nextCursor) ? <Link href={shopHref({ ...(q ? { q } : {}), ...(categoryId ? { categoryId } : {}), cursor: products.data.nextCursor })} className="inline-flex min-h-12 items-center gap-2 rounded-full border border-neutral-300 px-6 py-3 text-sm font-bold hover:border-neutral-900" rel="next">Next page <ArrowRight size={16} /></Link> : null}{products.data.nextCursor && !isValidShopCursor(products.data.nextCursor) ? <p role="status" className="text-sm text-neutral-700">The next page is temporarily unavailable. Please try again later.</p> : null}</nav> : null}
              </>
            )}
          </div>
        </section>
      </div>
    </Shell>
  );
}
