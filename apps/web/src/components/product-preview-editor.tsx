'use client';

import { useState } from 'react';
import { ImageOff, Info, Package } from 'lucide-react';

const inputClass = 'mt-2 block w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm text-neutral-950 outline-none placeholder:text-neutral-500 focus:border-brand-red focus:ring-2 focus:ring-red-200';

/** Local presentation only. This does not create a catalog draft or call an API. */
export function ProductPreviewEditor() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [brand, setBrand] = useState('');

  return (
    <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
      <section aria-labelledby="details-heading" className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-start gap-3"><span className="rounded-xl bg-red-50 p-2.5 text-brand-red"><Package size={20} aria-hidden="true" /></span><div><h2 id="details-heading" className="text-lg font-bold">Basic product details</h2><p className="mt-1 text-sm leading-6 text-neutral-600">These fields are for layout preview, not a catalog submission.</p></div></div>
        <div className="mt-7 space-y-6">
          <div><label htmlFor="preview-title" className="text-sm font-bold">Product name</label><input id="preview-title" className={inputClass} type="text" value={title} onChange={event => setTitle(event.target.value)} maxLength={200} placeholder="Enter a product name" aria-describedby="preview-title-help" /><p id="preview-title-help" className="mt-2 text-xs leading-5 text-neutral-600">Up to 200 characters.</p></div>
          <div><label htmlFor="preview-brand" className="text-sm font-bold">Brand <span className="font-normal text-neutral-600">(optional)</span></label><input id="preview-brand" className={inputClass} type="text" value={brand} onChange={event => setBrand(event.target.value)} maxLength={120} placeholder="Enter a brand" aria-describedby="preview-brand-help" /><p id="preview-brand-help" className="mt-2 text-xs leading-5 text-neutral-600">Up to 120 characters.</p></div>
          <div><label htmlFor="preview-description" className="text-sm font-bold">Description</label><textarea id="preview-description" className={`${inputClass} min-h-40 resize-y`} value={description} onChange={event => setDescription(event.target.value)} maxLength={5000} placeholder="Describe the product" aria-describedby="preview-description-help" /><p id="preview-description-help" className="mt-2 text-xs leading-5 text-neutral-600">Up to 5,000 characters. Only include claims you can support.</p></div>
        </div>
        <div className="mt-8 flex gap-3 rounded-xl bg-neutral-50 p-4 text-sm leading-6 text-neutral-700"><Info size={19} className="mt-0.5 shrink-0 text-neutral-600" aria-hidden="true" /><p>Images, categories, variants, pricing and stock are not available in this preview. Product management and submission are not connected.</p></div>
      </section>
      <section aria-labelledby="product-preview-heading" className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="product-preview-heading" className="text-lg font-bold">Layout preview</h2><span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-700">Not a listing</span></div>
        <p className="mt-2 text-xs leading-5 text-neutral-600">This is an illustration of the information entered, not a public product page.</p>
        <div className="mt-5 flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 text-neutral-600"><ImageOff size={28} aria-hidden="true" /><span className="text-xs font-medium">Image preview unavailable</span></div>
        <div className="min-w-0 pt-5"><p className="break-words text-xs font-semibold uppercase tracking-wide text-neutral-600">{brand.trim() || 'Brand not entered'}</p><h3 className="mt-2 break-words text-xl font-bold tracking-tight">{title.trim() || 'Product name'}</h3><p className="mt-2 text-sm font-semibold text-neutral-600">Price unavailable</p><div className="mt-5 border-t border-neutral-100 pt-4"><h4 className="text-sm font-bold">Description</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-neutral-600">{description.trim() || 'Product description will appear here.'}</p></div></div>
      </section>
    </div>
  );
}
