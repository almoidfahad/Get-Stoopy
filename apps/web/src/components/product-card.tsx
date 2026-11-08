import Link from 'next/link';
import { summarizeVariantPrices } from '@getstoopy/core';
import { formatCatalogPrice } from '@/lib/catalog-price';
import type { PublicProduct } from '@/lib/catalog';
import { ProductCardImage } from '@/components/product-card-image';

/**
 * A catalog card. Renders no price at all when nothing is orderable, rather than
 * a misleading zero, and states out-of-stock explicitly.
 */
export function ProductCard({ product }: { product: PublicProduct }) {
  const currency = product.currency;
  const summary = summarizeVariantPrices(product.variants.filter(variant => formatCatalogPrice(variant.priceAmountMinor, currency) !== null));
  const anyInStock = product.variants.some(variant => variant.inStock && variant.availableToPromise > 0);
  const lowest = summary.lowestMinor === null ? null : formatCatalogPrice(summary.lowestMinor.toString(), currency);
  const highest = summary.highestMinor === null ? null : formatCatalogPrice(summary.highestMinor.toString(), currency);
  const image = product.images[0];

  return (
    <li className="group flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white">
      <Link
        href={`/shop/${product.id}`}
        className="flex h-full flex-col"
        aria-label={`${product.title}${anyInStock ? '' : ' — out of stock'}`}
      >
        <div className="aspect-square w-full overflow-hidden bg-neutral-100">
          <ProductCardImage productId={product.id} productTitle={product.title} {...(image ? { image } : {})} />
        </div>
        <div className="flex flex-1 flex-col gap-1 p-4">
          {product.brand ? <p className="text-xs uppercase tracking-wide text-neutral-500">{product.brand}</p> : null}
          <h3 className="font-semibold leading-snug group-hover:text-brand-red">{product.title}</h3>
          {product.store ? <p className="text-sm text-neutral-600">{product.store.name}</p> : null}
          <div className="mt-auto pt-3">
            {anyInStock && lowest ? (
              <p className="font-bold">
                {summary.singlePrice || lowest === highest ? lowest : <span>From {lowest}</span>}
              </p>
            ) : (
              <p className="text-sm font-semibold text-neutral-600">{anyInStock ? 'Price unavailable' : 'Out of stock'}</p>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}