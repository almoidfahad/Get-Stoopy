'use client';

import { useEffect, useRef, useState } from 'react';
import { ImageOff, PackageSearch } from 'lucide-react';
import { imageProxyUrl } from '@/lib/catalog-image';

type GalleryImage = { id: string; altText: string | null };

/** Only image metadata from the public catalog is rendered; no external URL is accepted. */
type GalleryProps = { productId: string; productTitle: string; images: readonly GalleryImage[] };

export function ProductGallery(props: GalleryProps) {
  // Client navigation can reuse this component; selections and failures belong to one product.
  return <ProductGalleryForProduct key={props.productId} {...props} />;
}

function ProductGalleryForProduct({ productId, productTitle, images }: GalleryProps) {
  const mainImageRef = useRef<HTMLImageElement>(null);
  const [selectedId, setSelectedId] = useState(images[0]?.id ?? '');
  const [mainStates, setMainStates] = useState<Record<string, { attempt: number; status: 'loading' | 'failed' | 'loaded' }>>({});
  const [failedThumb, setFailedThumb] = useState<ReadonlySet<string>>(() => new Set());
  const selectedIndex = Math.max(0, images.findIndex(image => image.id === selectedId));
  const selected = images[selectedIndex];
  const imageKey = (image: GalleryImage) => JSON.stringify([productId, image.id]);
  const selectedKey = selected ? imageKey(selected) : '';
  const mainState = mainStates[selectedKey];
  const attempt = mainState?.attempt ?? 0;
  const recordMainState = (key: string, requestAttempt: number, status: 'failed' | 'loaded') => {
    setMainStates(previous => {
      if ((previous[key]?.attempt ?? 0) !== requestAttempt) return previous;
      // An initially successful image needs no extra announcement or control.
      if (status === 'loaded' && requestAttempt === 0) return previous;
      return { ...previous, [key]: { attempt: requestAttempt, status } };
    });
  };
  // A cached or very fast failure can occur before React hydrates and attaches onError.
  useEffect(() => {
    const image = mainImageRef.current;
    if (image?.complete) recordMainState(selectedKey, attempt, image.naturalWidth ? 'loaded' : 'failed');
  }, [selectedKey, attempt]);
  const retryPhoto = () => setMainStates(previous => ({
    ...previous, [selectedKey]: { attempt: (previous[selectedKey]?.attempt ?? 0) + 1, status: 'loading' },
  }));
  const recordThumbFailure = (image: GalleryImage) => setFailedThumb(previous => new Set(previous).add(imageKey(image)));
  const altFor = (image: GalleryImage) => image.altText?.trim() || productTitle;

  return (
    <section aria-label="Product photos" className="min-w-0">
      <figure>
        <div className="aspect-square w-full overflow-hidden rounded-2xl border border-neutral-200 bg-[#f8f5f1]">
          {!selected ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-neutral-600"><PackageSearch size={36} strokeWidth={1.5} aria-hidden="true" /><span className="text-sm">No image available</span></div>
          ) : mainState?.status === 'failed' ? (
            <div aria-hidden="true" className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-neutral-600"><ImageOff size={36} strokeWidth={1.5} /><span className="text-sm">Photo unavailable</span></div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img ref={mainImageRef} key={`${selectedKey}:${attempt}`} src={`${imageProxyUrl(productId, selected.id)}${attempt ? `?retry=${attempt}` : ''}`} alt={altFor(selected)} width={900} height={900} onError={() => recordMainState(selectedKey, attempt, 'failed')} onLoad={() => recordMainState(selectedKey, attempt, 'loaded')} className="h-full w-full object-contain" />
          )}
        </div>
        {selected ? <figcaption aria-live="polite" aria-atomic="true" className="mt-2 text-xs text-neutral-600">Photo {selectedIndex + 1} of {images.length}</figcaption> : null}
        {selected && mainState ? <div className="mt-3"><p role="status" aria-atomic="true" className="text-sm text-neutral-700">{mainState.status === 'failed' ? 'Photo could not be loaded.' : mainState.status === 'loading' ? 'Loading photo again…' : 'Photo loaded.'}</p><button type="button" onClick={retryPhoto} className="mt-2 inline-flex min-h-11 items-center rounded-full border border-neutral-400 px-4 text-sm font-semibold text-neutral-900 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950">{mainState.status === 'failed' ? 'Try photo again' : 'Reload photo'}</button></div> : null}
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
