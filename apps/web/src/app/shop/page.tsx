import Link from 'next/link';
import { Shell } from '@/components/shell';
import { ProductCard } from '@/components/product-card';
import { fetchCategories, fetchProducts } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

interface ShopSearchParams {
  q?: string;
  categoryId?: string;
  cursor?: string;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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
  const raw = await searchParams;
  const q = first(raw['q']);
  const categoryId = first(raw['categoryId']);
  const cursor = first(raw['cursor']);

  const [products, categories] = await Promise.all([
    fetchProducts({ q, categoryId, cursor }),
    fetchCategories(),
  ]);

  const categoryList = categories.state === 'ok' ? categories.data : [];

  return (
    <Shell>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Shop</h1>
        <p className="text-neutral-600">Published products from verified vendors in your market.</p>
      </div>

      <form action="/shop" method="get" className="mt-6 flex flex-col gap-3 sm:flex-row" role="search">
        <label className="flex-1">
          <span className="sr-only">Search products</span>
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            maxLength={120}
            placeholder="Search products or brands"
            className="w-full rounded-lg border border-neutral-300 px-4 py-3"
          />
        </label>
        {categoryId ? <input type="hidden" name="categoryId" value={categoryId} /> : null}
        <button type="submit" className="rounded-lg bg-brand-red px-6 py-3 font-semibold text-white">
          Search
        </button>
      </form>

      {categoryList.length > 0 ? (
        <nav aria-label="Categories" className="mt-5 flex flex-wrap gap-2">
          <Link
            href={shopHref({ ...(q ? { q } : {}) })}
            aria-current={categoryId ? undefined : 'page'}
            className={`rounded-full border px-4 py-2 text-sm ${categoryId ? 'border-neutral-300' : 'border-brand-red text-brand-red font-semibold'}`}
          >
            All
          </Link>
          {categoryList.map(category => (
            <Link
              key={category.id}
              href={shopHref({ categoryId: category.id, ...(q ? { q } : {}) })}
              aria-current={categoryId === category.id ? 'page' : undefined}
              className={`rounded-full border px-4 py-2 text-sm ${categoryId === category.id ? 'border-brand-red text-brand-red font-semibold' : 'border-neutral-300'}`}
            >
              {category.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <section className="mt-8" aria-live="polite">
        {products.state === 'not-configured' ? (
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-8">
            <h2 className="text-lg font-semibold">Market not configured</h2>
            <p className="mt-2 text-neutral-700">
              This deployment has no market country set, so there is no catalog to show. Configure
              <code className="mx-1 rounded bg-white px-1 py-0.5 font-mono text-sm">MARKET_COUNTRY_ID</code>
              to browse real published products. No demo products are substituted.
            </p>
          </div>
        ) : products.state === 'unavailable' || products.state === 'not-found' ? (
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-8">
            <h2 className="text-lg font-semibold">Catalog unavailable</h2>
            <p className="mt-2 text-neutral-700">
              The catalog service could not be reached. Please try again shortly.
            </p>
            <Link href={shopHref({ ...(q ? { q } : {}), ...(categoryId ? { categoryId } : {}) })} className="mt-4 inline-block font-semibold text-brand-red">
              Retry
            </Link>
          </div>
        ) : products.data.items.length === 0 ? (
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-8">
            <h2 className="text-lg font-semibold">No products found</h2>
            <p className="mt-2 text-neutral-700">
              {q ? `Nothing matched “${q}”.` : 'No published products are available in this market yet.'}
            </p>
            <Link href="/shop" className="mt-4 inline-block font-semibold text-brand-red">Clear filters</Link>
          </div>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {products.data.items.map(product => (
                <ProductCard key={product.id} product={product} />
              ))}
            </ul>
            {products.data.nextCursor ? (
              <div className="mt-8">
                <Link
                  href={shopHref({
                    ...(q ? { q } : {}),
                    ...(categoryId ? { categoryId } : {}),
                    cursor: products.data.nextCursor,
                  })}
                  className="inline-block rounded-lg border border-neutral-300 px-6 py-3 font-semibold"
                  rel="next"
                >
                  Next page
                </Link>
              </div>
            ) : null}
          </>
        )}
      </section>
    </Shell>
  );
}