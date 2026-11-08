'use client';

import { useState } from 'react';
import { ImageOff, PackageSearch } from 'lucide-react';
import { imageProxyUrl } from '@/lib/catalog-image';

type GalleryImage = { id: string; altText: string | null };

/** Only image metadata from the public catalog is rendered; no external URL is accepted. */
export function ProductGallery({ productId, productTitle, images }: { productId: string; productTitle: string; images: readonly GalleryImage[] }) {
  const [selectedId, setSelectedId] = useState(images[0]?.id ?? '');
  const [failedMain, setFailedMain] = useState<ReadonlySet<string>>(() => new Set());
  const [failedThumb, setFailedThumb] = useState<ReadonlySet<string>>(() => new Set());
  const selectedIndex = Math.max(0, images.findIndex(image => image.id === selectedId));
  const selected = images[selectedIndex];
  const imageKey = (image: GalleryImage) => JSON.stringify([productId, image.id]);
  const recordMainFailure = (image: GalleryImage) => setFailedMain(previous => new Set(previous).add(imageKey(image)));
  const recordThumbFailure = (image: GalleryImage) => setFailedThumb(previous => new Set(previous).add(imageKey(image)));
  const altFor = (image: GalleryImage) => image.altText?.trim() || productTitle;

  return (
    <section aria-label="Product photos" className="min-w-0">
      <figure>
        <div className="aspect-square w-full overflow-hidden rounded-2xl border border-neutral-200 bg-[#f8f5f1]">
          {!selected ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-neutral-600"><PackageSearch size={36} strokeWidth={1.5} aria-hidden="true" /><span className="text-sm">No image available</span></div>
          ) : failedMain.has(imageKey(selected)) ? (
            <div role="status" className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-neutral-600"><ImageOff size={36} strokeWidth={1.5} aria-hidden="true" /><span className="text-sm">Photo could not be loaded. Reload the page to try again.</span></div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageProxyUrl(productId, selected.id)} alt={altFor(selected)} width={900} height={900} onError={() => recordMainFailure(selected)} className="h-full w-full object-contain" />
          )}
        </div>
        {selected ? <figcaption aria-live="polite" aria-atomic="true" className="mt-2 text-xs text-neutral-600">Photo {selectedIndex + 1} of {images.length}</figcaption> : null}
      </figure>
      {images.length > 1 ? (
        <div className="mt-5"><h2 className="text-sm font-bold text-neutral-800">Product photos</h2><p className="mt-1 text-xs leading-5 text-neutral-600">Choose a photo to view it above.</p>
          <ul className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-5">{images.map((image, index) => {
            const active = selected?.id === image.id;
            return <li key={image.id} className="min-w-0"><button type="button" aria-label={`View photo ${index + 1}: ${altFor(image)}`} aria-pressed={active} onClick={() => setSelectedId(image.id)} className={`aspect-square w-full overflow-hidden rounded-xl border-2 bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red ${active ? 'border-brand-red' : 'border-neutral-200 hover:border-neutral-500'}`}>
              {failedThumb.has(imageKey(image)) ? <span className="flex h-full items-center justify-center px-1 text-xs text-neutral-600">Unavailable</span> : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageProxyUrl(productId, image.id)} alt="" width={180} height={180} loading="lazy" onError={() => recordThumbFailure(image)} className="h-full w-full object-cover" />
              )}
            </button></li>;
          })}</ul>
        </div>
      ) : null}
    </section>
  );
}
