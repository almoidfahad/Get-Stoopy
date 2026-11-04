import Link from 'next/link';
import { formatMinorUnits, summarizeVariantPrices } from '@getstoopy/core';
import type { PublicProduct } from '@/lib/catalog';
import { imageProxyUrl } from '@/lib/catalog';

/**
 * A catalog card. Renders no price at all when nothing is orderable, rather than
 * a misleading zero, and states out-of-stock explicitly.
 */
export function ProductCard({ product }: { product: PublicProduct }) {
  const summary = summarizeVariantPrices(product.variants);
  const currency = product.currency || 'BDT';
  const lowest = summary.lowestMinor === null ? null : formatMinorUnits(summary.lowestMinor.toString(), currency);
  const highest = summary.highestMinor === null ? null : formatMinorUnits(summary.highestMinor.toString(), currency);
  const image = product.images[0];

  return (
    <li className="group flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white">
      <Link
        href={`/shop/${product.id}`}
        className="flex h-full flex-col"
        aria-label={`${product.title}${summary.anyInStock ? '' : ' — out of stock'}`}
      >
        <div className="aspect-square w-full overflow-hidden bg-neutral-100">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageProxyUrl(product.id, image.id)}
              alt={image.altText ?? product.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500" aria-hidden="true">
              No image
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-4">
          {product.brand ? <p className="text-xs uppercase tracking-wide text-neutral-500">{product.brand}</p> : null}
          <h3 className="font-semibold leading-snug group-hover:text-brand-red">{product.title}</h3>
          {product.store ? <p className="text-sm text-neutral-600">{product.store.name}</p> : null}
          <div className="mt-auto pt-3">
            {summary.anyInStock && lowest ? (
              <p className="font-bold">
                {summary.singlePrice || lowest === highest ? lowest : <span>From {lowest}</span>}
              </p>
            ) : (
              <p className="text-sm font-semibold text-neutral-600">Out of stock</p>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}