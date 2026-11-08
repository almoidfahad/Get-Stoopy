'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

interface VariantPreview { id: number; label: string; sku: string; price: string; currency: string }
const MAX_OPTIONS = 8; // A layout-preview limit, not a catalog policy.
const MAX_PRICE = BigInt(Number.MAX_SAFE_INTEGER);
const fieldClass = 'mt-2 min-h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm text-neutral-950 placeholder:text-neutral-500';
function blank(id: number): VariantPreview { return { id, label: '', sku: '', price: '', currency: '' }; }
function isValidMinorPrice(value: string): boolean {
  return /^[1-9][0-9]{0,15}$/.test(value) && BigInt(value) <= MAX_PRICE;
}

/** Interactive layout only. There is no form, network call, storage or catalog draft. */
export function VariantLayoutPreview() {
  const [variants, setVariants] = useState<VariantPreview[]>([blank(1)]);
  const [announcement, setAnnouncement] = useState('');
  const nextId = useRef(2);
  const addButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<number | 'add' | null>(null);
  useEffect(() => {
    if (pendingFocus.current === 'add') addButton.current?.focus();
    else if (typeof pendingFocus.current === 'number') document.getElementById(`preview-option-${pendingFocus.current}-label`)?.focus();
    pendingFocus.current = null;
  }, [variants]);
  function update(id: number, field: keyof Omit<VariantPreview, 'id'>, value: string) {
    setVariants(current => current.map(variant => variant.id === id ? { ...variant, [field]: value } : variant));
  }
  function addVariant() {
    if (variants.length >= MAX_OPTIONS) return;
    const id = nextId.current++;
    pendingFocus.current = id;
    setVariants(current => [...current, blank(id)]);
    setAnnouncement(`Preview option ${id} added.`);
  }
  function removeVariant(id: number) {
    if (variants.length <= 1) return;
    pendingFocus.current = 'add';
    setVariants(current => current.filter(variant => variant.id !== id));
    setAnnouncement(`Preview option ${id} removed.`);
  }
  return (
    <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,.75fr)]">
      <section aria-labelledby="options-heading" className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-7">
        <h2 id="options-heading" className="text-lg font-bold">Preview product options</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">Try up to eight temporary options in this layout. This limit applies only to the preview.</p>
        <div className="mt-6 space-y-5">{variants.map(variant => {
          const priceError = variant.price !== '' && !isValidMinorPrice(variant.price);
          const currencyError = variant.currency !== '' && !/^[A-Z]{3}$/.test(variant.currency);
          const prefix = `preview-option-${variant.id}`;
          return <fieldset key={variant.id} className="rounded-xl border border-neutral-200 p-4 sm:p-5">
            <legend className="px-1 text-sm font-bold">Preview option {variant.id}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label htmlFor={`${prefix}-label`} className="text-sm font-semibold">Option name</label><input id={`${prefix}-label`} className={fieldClass} value={variant.label} onChange={event => update(variant.id, 'label', event.target.value)} maxLength={120} placeholder="For example, a size" /></div>
              <div><label htmlFor={`${prefix}-sku`} className="text-sm font-semibold">SKU</label><input id={`${prefix}-sku`} className={fieldClass} value={variant.sku} onChange={event => update(variant.id, 'sku', event.target.value)} maxLength={120} placeholder="Preview SKU" /></div>
              <div><label htmlFor={`${prefix}-price`} className="text-sm font-semibold">Price in minor units</label><input id={`${prefix}-price`} className={fieldClass} value={variant.price} onChange={event => update(variant.id, 'price', event.target.value)} inputMode="numeric" maxLength={16} placeholder="Whole number" aria-invalid={priceError || undefined} aria-describedby={`${prefix}-price-help`} /><p id={`${prefix}-price-help`} className={`mt-2 text-xs leading-5 ${priceError ? 'font-semibold text-brand-red' : 'text-neutral-600'}`}>{priceError ? 'Enter a positive whole number within the supported limit, without leading zeroes.' : 'Enter the smallest currency units; no currency conversion is performed.'}</p></div>
              <div><label htmlFor={`${prefix}-currency`} className="text-sm font-semibold">Currency code</label><input id={`${prefix}-currency`} className={fieldClass} value={variant.currency} onChange={event => update(variant.id, 'currency', event.target.value)} maxLength={3} placeholder="Three uppercase letters" aria-invalid={currencyError || undefined} aria-describedby={`${prefix}-currency-help`} /><p id={`${prefix}-currency-help`} className={`mt-2 text-xs leading-5 ${currencyError ? 'font-semibold text-brand-red' : 'text-neutral-600'}`}>{currencyError ? 'Use three uppercase letters.' : 'A real variant must match the store market currency; this preview cannot check that.'}</p></div>
            </div>
            {variants.length > 1 ? <button type="button" onClick={() => removeVariant(variant.id)} aria-label={`Remove preview option ${variant.id}`} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-bold hover:border-neutral-900"><Trash2 size={16} aria-hidden="true" /> Remove option</button> : <p className="mt-5 text-xs text-neutral-600">At least one option is shown in this preview.</p>}
          </fieldset>;
        })}</div>
        <button ref={addButton} type="button" onClick={addVariant} disabled={variants.length >= MAX_OPTIONS} className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-full border border-neutral-400 px-5 py-3 text-sm font-bold hover:border-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"><Plus size={17} aria-hidden="true" /> Add another preview option</button>
        {variants.length >= MAX_OPTIONS ? <p className="mt-2 text-xs text-neutral-600">The preview limit has been reached.</p> : null}
        <p aria-live="polite" className="sr-only">{announcement}</p>
      </section>
      <section aria-labelledby="options-preview-heading" className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="options-preview-heading" className="text-lg font-bold">Option layout</h2><span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-700">Not a listing</span></div>
        <p className="mt-2 text-sm leading-6 text-neutral-600">Only the information entered here is shown. It is not an actual product, offer or price.</p>
        <ul className="mt-5 space-y-3">{variants.map(variant => <li key={variant.id} className="min-w-0 rounded-xl border border-neutral-200 bg-neutral-50 p-4"><p className="break-words font-bold">{variant.label.trim() || `Preview option ${variant.id}`}</p><p className="mt-1 break-all text-xs text-neutral-600">SKU: {variant.sku.trim() || 'Not entered'}</p><p className="mt-3 break-words text-sm font-semibold text-neutral-800">{isValidMinorPrice(variant.price) && /^[A-Z]{3}$/.test(variant.currency) ? `${variant.price} minor units (${variant.currency})` : 'Price not shown'}</p></li>)}</ul>
        <p className="mt-5 border-t border-neutral-200 pt-4 text-xs leading-5 text-neutral-600">Store currency, SKU uniqueness, option structure and catalog eligibility are not verified. Stock, photos, saving and publication are unavailable.</p>
      </section>
    </div>
  );
}
