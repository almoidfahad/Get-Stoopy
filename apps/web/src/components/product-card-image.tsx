'use client';

import { useState } from 'react';
import { ImageOff, PackageSearch } from 'lucide-react';
import { imageProxyUrl } from '@/lib/catalog-image';

type CardImage = { id: string; altText: string | null };

/** The image is supplementary to the named product link; failures stay local to this card. */
function LoadableImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div aria-hidden="true" className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-neutral-600"><ImageOff size={26} strokeWidth={1.5} /><span className="text-xs sm:text-sm">Image unavailable</span></div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} width={500} height={500} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
  );
}

export function ProductCardImage({ productId, productTitle, image }: { productId: string; productTitle: string; image?: CardImage }) {
  if (!image) {
    return <div aria-hidden="true" className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-neutral-600"><PackageSearch size={26} strokeWidth={1.5} /><span className="text-xs sm:text-sm">No image available</span></div>;
  }
  const src = imageProxyUrl(productId, image.id);
  // Changing the image creates a fresh loading state instead of keeping another image's error.
  return <LoadableImage key={src} src={src} alt={image.altText?.trim() || productTitle} />;
}
