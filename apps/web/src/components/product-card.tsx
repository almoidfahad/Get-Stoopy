import Link from 'next/link';
import { summarizeVariantPrices } from '@getstoopy/core';
import { formatCatalogPrice } from '@/lib/catalog-price';
import type { PublicProduct } from '@/lib/catalog';
import { ProductCardImage } from '@/components/product-card-image';
import { productHref, type ShopInput } from '@/lib/shop-query';

/**
 * A catalog card. Renders no price at all when nothing is orderable, rather than
 * a misleading zero, and states out-of-stock explicitly.
 */
export function ProductCard({ product, shopContext }: { product: PublicProduct; shopContext?: ShopInput }) {
  const currency = product.currency;
  const summary = summarizeVariantPrices(product.variants.filter(variant => formatCatalogPrice(variant.priceAmountMinor, currency) !== null));
  const anyInStock = product.variants.some(variant => variant.inStock && variant.availableToPromise > 0);
  const lowest = summary.lowestMinor === null ? null : formatCatalogPrice(summary.lowestMinor.toString(), currency);
  const highest = summary.highestMinor === null ? null : formatCatalogPrice(summary.highestMinor.toString(), currency);
  const image = product.images[0];
  const priceText = anyInStock && lowest
    ? summary.singlePrice || lowest === highest ? lowest : `From ${lowest}`
    : anyInStock ? 'Price unavailable' : 'Out of stock';
  // The link's accessible name must include the same useful details shown on
  // the card; an aria-label containing only the title hides the brand, store and price.
  const accessibleName = [product.title, product.brand, product.store?.name, priceText].filter(Boolean).join(' — ');

  return (
    <li className="group flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white">
      <Link
        href={productHref(product.id, shopContext)}
        className="flex h-full flex-col"
        aria-label={accessibleName}
      >
        <div className="aspect-square w-full overflow-hidden bg-neutral-100">
          <ProductCardImage productId={product.id} productTitle={product.title} {...(image ? { image } : {})} />
        </div>
        <div className="flex flex-1 flex-col gap-1 p-4">
          {product.brand ? <p className="break-words text-xs uppercase tracking-wide text-neutral-500 [overflow-wrap:anywhere]">{product.brand}</p> : null}
          <h3 className="break-words font-semibold leading-snug [overflow-wrap:anywhere] group-hover:text-brand-red">{product.title}</h3>
          {product.store ? <p className="break-words text-sm text-neutral-600 [overflow-wrap:anywhere]">{product.store.name}</p> : null}
          <div className="mt-auto pt-3">
            <p className={`break-words [overflow-wrap:anywhere] ${anyInStock && lowest ? 'font-bold' : 'text-sm font-semibold text-neutral-600'}`}>{priceText}</p>
          </div>
        </div>
      </Link>
    </li>
  );
}