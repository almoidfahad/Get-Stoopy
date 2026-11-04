import Link from 'next/link';
import { notFound } from 'next/navigation';
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
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-8">
          <h1 className="text-2xl font-bold">
            {result.state === 'not-configured' ? 'Market not configured' : 'Product unavailable'}
          </h1>
          <p className="mt-2 text-neutral-700">
            {result.state === 'not-configured'
              ? 'This deployment has no market country set, so no catalog can be shown.'
              : 'The catalog service could not be reached. Please try again shortly.'}
          </p>
          <Link href="/shop" className="mt-4 inline-block font-semibold text-brand-red">Back to shop</Link>
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
      <nav aria-label="Breadcrumb" className="text-sm text-neutral-600">
        <Link href="/shop" className="hover:text-brand-red">Shop</Link>
        {product.category ? (
          <>
            <span aria-hidden="true"> / </span>
            <Link href={`/shop?categoryId=${product.category.id}`} className="hover:text-brand-red">
              {product.category.name}
            </Link>
          </>
        ) : null}
      </nav>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div>
          <div className="aspect-square w-full overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-100">
            {product.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageProxyUrl(product.id, product.images[0].id)}
                alt={product.images[0].altText ?? product.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-neutral-500">No image</div>
            )}
          </div>
          {product.images.length > 1 ? (
            <ul className="mt-3 flex gap-3">
              {product.images.slice(1, 5).map(image => (
                <li key={image.id} className="h-20 w-20 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageProxyUrl(product.id, image.id)}
                    alt={image.altText ?? product.title}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div>
          {product.brand ? <p className="text-sm uppercase tracking-wide text-neutral-500">{product.brand}</p> : null}
          <h1 className="mt-1 text-3xl font-bold">{product.title}</h1>
          {product.store ? (
            <p className="mt-2 text-neutral-700">
              Sold by <span className="font-semibold">{product.store.name}</span>
            </p>
          ) : null}

          <div className="mt-6">
            {summary.anyInStock && summary.lowestMinor !== null ? (
              <p className="text-2xl font-bold">
                {summary.singlePrice
                  ? formatMinorUnits(summary.lowestMinor.toString(), currency)
                  : `${formatMinorUnits(summary.lowestMinor.toString(), currency)} – ${formatMinorUnits((summary.highestMinor as bigint).toString(), currency)}`}
              </p>
            ) : (
              <p className="text-xl font-semibold text-neutral-600">Out of stock</p>
            )}
          </div>

          <h2 className="mt-8 text-lg font-semibold">Options</h2>
          {product.variants.length === 0 ? (
            <p className="mt-2 text-neutral-600">This product has no available options.</p>
          ) : (
            <ul className="mt-3 divide-y divide-neutral-200 rounded-xl border border-neutral-200">
              {product.variants.map(variant => {
                const orderable = variant.inStock && variant.availableToPromise > 0;
                const price = formatMinorUnits(variant.priceAmountMinor, currency);
                return (
                  <li key={variant.id} className="flex items-center justify-between gap-4 p-4">
                    <div>
                      <p className="font-medium">{variant.title ?? variant.id.slice(0, 8)}</p>
                      <p className={`text-sm ${orderable ? 'text-neutral-600' : 'text-neutral-500'}`}>
                        {orderable ? `${variant.availableToPromise} available` : 'Out of stock'}
                      </p>
                    </div>
                    <p className="font-semibold">{price ?? 'Price unavailable'}</p>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-8">
            {orderable.length > 0 ? (
              <AddToCart variants={orderable} signedIn={signedIn} />
            ) : (
              <p className="text-sm font-medium text-neutral-600">Nothing is currently available to order.</p>
            )}
          </div>

          <div className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
            You can build a cart, but checkout is not enabled in this environment. Prices and stock come from
            the live catalog service; no payment is taken.
          </div>

          {product.description ? (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">Description</h2>
              <p className="mt-2 whitespace-pre-line text-neutral-700">{product.description}</p>
            </section>
          ) : null}
        </div>
      </div>
    </Shell>
  );
}