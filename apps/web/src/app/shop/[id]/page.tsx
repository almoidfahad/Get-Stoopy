import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, PackageSearch } from 'lucide-react';
import { summarizeVariantPrices } from '@getstoopy/core';
import { formatCatalogPrice } from '@/lib/catalog-price';
import { Shell } from '@/components/shell';
import { fetchProduct } from '@/lib/catalog';
import { ProductGallery } from '@/components/product-gallery';
import { hasSessionCookie } from '@/lib/cart';
import { AddToCart } from '@/components/cart-controls';

export const dynamic = 'force-dynamic';

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await fetchProduct(id);

  if (result.state === 'not-found') notFound();

  if (result.state !== 'ok') {
    return (
      <Shell>
        <div className="max-w-2xl rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-8 sm:p-10">
          <PackageSearch size={30} className="text-brand-red" aria-hidden="true" />
          <h1 className="mt-4 text-2xl font-black tracking-tight">{result.state === 'not-configured' ? 'Market not configured' : 'Product unavailable'}</h1>
          <p className="mt-2 text-sm leading-6 text-neutral-700">{result.state === 'not-configured' ? 'This deployment has no market country set, so no catalog can be shown.' : 'The catalog service could not be reached. Please try again shortly.'}</p>
          <Link href="/shop" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-brand-red hover:underline"><ArrowLeft size={16} /> Back to shop</Link>
        </div>
      </Shell>
    );
  }

  const product = result.data;
  const currency = product.currency;
  const summary = summarizeVariantPrices(product.variants.filter(v => formatCatalogPrice(v.priceAmountMinor, currency) !== null));
  const signedIn = await hasSessionCookie();
  const anyAvailable = product.variants.some(v => v.inStock && v.availableToPromise > 0);
  const orderable = product.variants.flatMap(variant => {
    const priceLabel = formatCatalogPrice(variant.priceAmountMinor, currency);
    return variant.inStock && variant.availableToPromise > 0 && priceLabel !== null
      ? [{ id: variant.id, label: variant.title?.trim() || variant.id.slice(0, 8), priceLabel }]
      : [];
  });

  const lowestPrice = summary.lowestMinor === null ? null : formatCatalogPrice(summary.lowestMinor.toString(), currency);
  const highestPrice = summary.highestMinor === null ? null : formatCatalogPrice(summary.highestMinor.toString(), currency);

  return (
    <Shell>
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-neutral-600 [overflow-wrap:anywhere]">
        <Link href="/shop" className="hover:text-brand-red">Shop</Link>
        {product.category ? <><span aria-hidden="true" className="text-neutral-400">/</span><Link href={`/shop?${new URLSearchParams({ categoryId: product.category.id }).toString()}`} className="hover:text-brand-red">{product.category.name}</Link></> : null}
        <span aria-hidden="true" className="text-neutral-400">/</span><span aria-current="page" className="font-semibold text-neutral-900">{product.title}</span>
      </nav>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
        <ProductGallery productId={product.id} productTitle={product.title} images={product.images} />

        <div className="min-w-0">
          <p className="section-eyebrow">The collection</p>
          {product.brand ? <p className="mt-3 break-words text-sm font-semibold text-neutral-600 [overflow-wrap:anywhere]">{product.brand}</p> : null}
          <h1 className="mt-2 break-words text-3xl font-black leading-tight tracking-[-.035em] text-neutral-950 [overflow-wrap:anywhere] sm:text-4xl">{product.title}</h1>
          {product.store ? <p className="mt-3 break-words text-sm text-neutral-600 [overflow-wrap:anywhere]">Sold by <span className="font-bold text-neutral-900">{product.store.name}</span></p> : null}

          <div className="mt-6 border-y border-neutral-200 py-5">
            {lowestPrice !== null && highestPrice !== null ? (
              <p className="text-2xl font-black text-neutral-950">{summary.singlePrice ? lowestPrice : `${lowestPrice} – ${highestPrice}`}</p>
            ) : <p className="text-lg font-semibold text-neutral-600">{anyAvailable ? 'Price unavailable' : 'Out of stock'}</p>}
          </div>

          <section aria-labelledby="options-heading" className="mt-7">
            <h2 id="options-heading" className="text-lg font-bold text-neutral-950">Product options</h2>
            {product.variants.length === 0 ? <p className="mt-3 text-sm text-neutral-600">This product has no available options.</p> : (
              <ul className="mt-3 divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200">
                {product.variants.map(variant => {
                  const available = variant.inStock && variant.availableToPromise > 0;
                  const price = formatCatalogPrice(variant.priceAmountMinor, currency);
                  return <li key={variant.id} className="flex flex-wrap items-center justify-between gap-4 bg-white p-4"><div className="min-w-0"><p className="break-words text-sm font-bold text-neutral-900 [overflow-wrap:anywhere]">{variant.title ?? variant.id.slice(0, 8)}</p><p className="mt-1 text-sm text-neutral-600">{available ? `${variant.availableToPromise} available` : 'Out of stock'}</p></div><p className="shrink-0 text-sm font-bold text-neutral-900">{price ?? 'Price unavailable'}</p></li>;
                })}
              </ul>
            )}
          </section>

          <div className="mt-6 rounded-2xl bg-[#faf5ee] p-5 sm:p-6">
            {orderable.length ? <AddToCart key={product.id} variants={orderable} signedIn={signedIn} /> : <p className="text-sm font-medium text-neutral-700">{anyAvailable ? 'Pricing is unavailable for the available options. Please try again later.' : 'Nothing is currently available to order.'}</p>}
            <p className="mt-4 text-xs leading-5 text-neutral-600">Checkout may reserve stock where available. Delivery fees, payment and order confirmation are not yet available.</p>
          </div>

          {product.description ? <section aria-labelledby="description-heading" className="mt-8 border-t border-neutral-200 pt-6"><h2 id="description-heading" className="text-lg font-bold text-neutral-950">Description</h2><p className="mt-3 whitespace-pre-line break-words text-sm leading-7 text-neutral-700 [overflow-wrap:anywhere]">{product.description}</p></section> : null}
        </div>
      </div>
    </Shell>
  );
}
