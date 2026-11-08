'use client';

import { useState } from 'react';
import { Bike, ClipboardList, KeyRound, MapPin } from 'lucide-react';

type Stage = 'offer' | 'pickup' | 'proof';
const buttonClass = 'inline-flex min-h-12 items-center justify-center rounded-full border border-neutral-300 bg-neutral-100 px-5 py-3 text-sm font-bold text-neutral-600 disabled:cursor-not-allowed';

/** Layout-only states: no offer, recipient, location or OTP is read or submitted. */
export function RiderDeliveryPreview() {
  const [stage, setStage] = useState<Stage>('offer');
  return (
    <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="delivery-stage-heading" className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-7">
        <fieldset><legend id="delivery-stage-heading" className="text-lg font-bold">Explore a layout state</legend><p className="mt-2 text-sm leading-6 text-neutral-600">These choices change only this preview; they do not change a delivery.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">{([
            ['offer', 'Offer'], ['pickup', 'Pickup & route'], ['proof', 'Delivery proof'],
          ] as const).map(([value, label]) => <label key={value} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm font-bold ${stage === value ? 'border-brand-red bg-red-50' : 'border-neutral-300'}`}><input type="radio" name="rider-preview-stage" value={value} checked={stage === value} onChange={() => setStage(value)} className="accent-brand-red" />{label}</label>)}</div>
        </fieldset>
        <div className="mt-7 border-t border-neutral-200 pt-6" aria-live="polite">
          {stage === 'offer' ? <div><div className="flex items-center gap-3"><ClipboardList className="text-brand-red" size={22} aria-hidden="true" /><h2 className="text-lg font-bold">Offer layout</h2></div><p className="mt-2 text-sm leading-6 text-neutral-600">Offer details and an expiry must come from the authorized service. No real offer or countdown is shown here.</p><dl className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-neutral-50 p-4"><dt className="text-xs font-semibold text-neutral-600">Pickup</dt><dd className="mt-1 text-sm font-bold">Unavailable in preview</dd></div><div className="rounded-xl bg-neutral-50 p-4"><dt className="text-xs font-semibold text-neutral-600">Offer expiry</dt><dd className="mt-1 text-sm font-bold">Unavailable in preview</dd></div></dl><div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled className={buttonClass}>Accept offer</button><button type="button" disabled className={buttonClass}>Decline offer</button></div></div> : null}
          {stage === 'pickup' ? <div><div className="flex items-center gap-3"><Bike className="text-brand-red" size={22} aria-hidden="true" /><h2 className="text-lg font-bold">Pickup & route layout</h2></div><p className="mt-2 text-sm leading-6 text-neutral-600">Assignment and route details are not connected. No location is requested or displayed in this preview.</p><dl className="mt-5 space-y-3"><div className="rounded-xl bg-neutral-50 p-4"><dt className="text-xs font-semibold text-neutral-600">Pickup location</dt><dd className="mt-1 text-sm font-bold">Unavailable in preview</dd></div><div className="rounded-xl bg-neutral-50 p-4"><dt className="text-xs font-semibold text-neutral-600">Delivery destination</dt><dd className="mt-1 text-sm font-bold">Unavailable in preview</dd></div></dl><div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled className={buttonClass}>Confirm pickup</button><button type="button" disabled className={buttonClass}>Open navigation</button></div></div> : null}
          {stage === 'proof' ? <div><div className="flex items-center gap-3"><KeyRound className="text-brand-red" size={22} aria-hidden="true" /><h2 className="text-lg font-bold">Delivery proof layout</h2></div><p className="mt-2 text-sm leading-6 text-neutral-600">Recipient verification is not connected. This preview cannot receive or verify a code.</p><label htmlFor="preview-recipient-code" className="mt-5 block text-sm font-bold">Recipient verification code</label><input id="preview-recipient-code" disabled inputMode="numeric" autoComplete="off" placeholder="Unavailable in preview" className="mt-2 min-h-12 w-full rounded-xl border border-neutral-300 bg-neutral-100 px-4 py-3 text-sm text-neutral-600" /><button type="button" disabled className={`${buttonClass} mt-5`}>Confirm delivery</button></div> : null}
        </div>
      </section>
      <aside aria-labelledby="rider-preview-boundary" className="rounded-2xl border border-neutral-200 bg-white p-6"><MapPin size={22} className="text-brand-red" aria-hidden="true" /><h2 id="rider-preview-boundary" className="mt-4 text-lg font-bold">No live delivery</h2><p className="mt-2 text-sm leading-6 text-neutral-600">This layout does not show rider duty status, a map, recipient details, earnings or live delivery information.</p><p className="mt-4 border-t border-neutral-200 pt-4 text-sm leading-6 text-neutral-600">Real offers, assignments, pickup and proof must be authorized and handled by the delivery service.</p></aside>
    </div>
  );
}
