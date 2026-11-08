import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, PackageSearch } from 'lucide-react';
import { formatMinorUnits, summarizeVariantPrices } from '@getstoopy/core';
import { Shell } from '@/components/shell';
import { fetchProduct, imageProxyUrl } from '@/lib/catalog';
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
  const currency = product.currency || 'BDT';
  const summary = summarizeVariantPrices(product.variants);
  const signedIn = await hasSessionCookie();
  const orderable = product.variants
    .filter(v => v.inStock && v.availableToPromise > 0)
    .map(v => ({ id: v.id, label: v.title ?? v.id.slice(0, 8) }));

  return (
    <Shell>
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
        <Link href="/shop" className="hover:text-brand-red">Shop</Link>
        {product.category ? <><span aria-hidden="true" className="text-neutral-400">/</span><Link href={`/shop?${new URLSearchParams({ categoryId: product.category.id }).toString()}`} className="hover:text-brand-red">{product.category.name}</Link></> : null}
        <span aria-hidden="true" className="text-neutral-400">/</span><span aria-current="page" className="font-semibold text-neutral-900">{product.title}</span>
      </nav>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
        <div className="min-w-0">
          <div className="aspect-square w-full overflow-hidden rounded-2xl border border-neutral-200 bg-[#f8f5f1]">
            {product.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageProxyUrl(product.id, product.images[0].id)} alt={product.images[0].altText ?? product.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-neutral-500"><PackageSearch size={36} strokeWidth={1.5} aria-hidden="true" /><span className="text-sm">No image available</span></div>
            )}
          </div>
          {product.images.length > 1 ? (
            <section aria-labelledby="more-images" className="mt-5"><h2 id="more-images" className="text-sm font-bold text-neutral-800">More product photos</h2><ul className="mt-3 grid grid-cols-4 gap-3">
              {product.images.slice(1, 5).map(image => <li key={image.id} className="aspect-square overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={imageProxyUrl(product.id, image.id)} alt={image.altText ?? product.title} className="h-full w-full object-cover" loading="lazy" /></li>)}
            </ul></section>
          ) : null}
        </div>

        <div className="min-w-0">
          <p className="section-eyebrow">The collection</p>
          {product.brand ? <p className="mt-3 text-sm font-semibold text-neutral-600">{product.brand}</p> : null}
          <h1 className="mt-2 text-3xl font-black leading-tight tracking-[-.035em] text-neutral-950 sm:text-4xl">{product.title}</h1>
          {product.store ? <p className="mt-3 text-sm text-neutral-600">Sold by <span className="font-bold text-neutral-900">{product.store.name}</span></p> : null}

          <div className="mt-6 border-y border-neutral-200 py-5">
            {summary.lowestMinor !== null && summary.highestMinor !== null ? (
              <p className="text-2xl font-black text-neutral-950">{summary.singlePrice ? formatMinorUnits(summary.lowestMinor.toString(), currency) : `${formatMinorUnits(summary.lowestMinor.toString(), currency)} – ${formatMinorUnits(summary.highestMinor.toString(), currency)}`}</p>
            ) : <p className="text-lg font-semibold text-neutral-600">{orderable.length ? 'Price unavailable' : 'Out of stock'}</p>}
          </div>

          <section aria-labelledby="options-heading" className="mt-7">
            <h2 id="options-heading" className="text-lg font-bold text-neutral-950">Product options</h2>
            {product.variants.length === 0 ? <p className="mt-3 text-sm text-neutral-600">This product has no available options.</p> : (
              <ul className="mt-3 divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200">
                {product.variants.map(variant => {
                  const available = variant.inStock && variant.availableToPromise > 0;
                  const price = formatMinorUnits(variant.priceAmountMinor, currency);
                  return <li key={variant.id} className="flex items-center justify-between gap-4 bg-white p-4"><div className="min-w-0"><p className="break-words text-sm font-bold text-neutral-900">{variant.title ?? variant.id.slice(0, 8)}</p><p className="mt-1 text-sm text-neutral-600">{available ? `${variant.availableToPromise} available` : 'Out of stock'}</p></div><p className="shrink-0 text-sm font-bold text-neutral-900">{price ?? 'Price unavailable'}</p></li>;
                })}
              </ul>
            )}
          </section>

          <div className="mt-6 rounded-2xl bg-[#faf5ee] p-5 sm:p-6">
            {orderable.length ? <AddToCart variants={orderable} signedIn={signedIn} /> : <p className="text-sm font-medium text-neutral-700">Nothing is currently available to order.</p>}
            <p className="mt-4 text-xs leading-5 text-neutral-600">Checkout may reserve stock where available. Delivery fees, payment and order confirmation are not yet available.</p>
          </div>

          {product.description ? <section aria-labelledby="description-heading" className="mt-8 border-t border-neutral-200 pt-6"><h2 id="description-heading" className="text-lg font-bold text-neutral-950">Description</h2><p className="mt-3 whitespace-pre-line text-sm leading-7 text-neutral-700">{product.description}</p></section> : null}
        </div>
      </div>
    </Shell>
  );
}
