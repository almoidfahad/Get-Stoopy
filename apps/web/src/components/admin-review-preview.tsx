'use client';

import { useState } from 'react';
import { FileCheck2, ShieldCheck } from 'lucide-react';

type ReviewKind = 'product' | 'identity';
const buttonClass = 'min-h-12 rounded-full border border-neutral-300 bg-neutral-100 px-5 py-3 text-sm font-bold text-neutral-600 disabled:cursor-not-allowed';

/** Public, data-free layout; it cannot read a queue or make a decision. */
export function AdminReviewPreview() {
  const [kind, setKind] = useState<ReviewKind>('product');
  return <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <section aria-labelledby="review-kind-heading" className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-7">
      <fieldset><legend id="review-kind-heading" className="text-lg font-bold">Explore a review layout</legend><p className="mt-2 text-sm leading-6 text-neutral-600">This selector changes the layout only. It does not load records.</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{([['product', 'Product moderation'], ['identity', 'Identity review']] as const).map(([value,label]) => <label key={value} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm font-bold ${kind === value ? 'border-brand-red bg-red-50' : 'border-neutral-300'}`}><input type="radio" name="admin-review-preview" value={value} checked={kind === value} onChange={() => setKind(value)} className="accent-brand-red" />{label}</label>)}</div></fieldset>
      <div aria-live="polite" className="mt-7 border-t border-neutral-200 pt-6"><div className="flex items-center gap-3"><FileCheck2 size={22} className="text-brand-red" aria-hidden="true" /><h2 className="text-lg font-bold">{kind === 'product' ? 'Product review layout' : 'Identity review layout'}</h2></div><p className="mt-2 text-sm leading-6 text-neutral-600">{kind === 'product' ? 'Product information and review status are not connected.' : 'Identity cases, evidence and review status are not connected.'} No records are shown in this preview.</p>
        <div className="mt-5 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center"><p className="text-sm font-bold text-neutral-800">Record details unavailable</p><p className="mt-1 text-xs leading-5 text-neutral-600">This is not an empty queue or an indication of a real case.</p></div>
        <label htmlFor="preview-review-reason" className="mt-5 block text-sm font-bold">Decision reason</label><textarea id="preview-review-reason" disabled rows={3} placeholder="Unavailable in preview" className="mt-2 w-full rounded-xl border border-neutral-300 bg-neutral-100 px-4 py-3 text-sm text-neutral-600" /><div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled className={buttonClass}>Approve</button><button type="button" disabled className={buttonClass}>Reject</button></div>
      </div>
    </section>
    <aside aria-labelledby="review-preview-boundary" className="rounded-2xl border border-neutral-200 bg-white p-6"><ShieldCheck size={22} className="text-brand-red" aria-hidden="true" /><h2 id="review-preview-boundary" className="mt-4 text-lg font-bold">Access is not verified</h2><p className="mt-2 text-sm leading-6 text-neutral-600">This public preview does not check or grant admin permissions or geographic scope.</p><p className="mt-4 border-t border-neutral-200 pt-4 text-sm leading-6 text-neutral-600">A real review requires server-side authorization, appropriate scope and any required step-up or independent approval.</p></aside>
  </div>;
}
