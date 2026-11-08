'use client';

import { useState } from 'react';
import { MapPin, UserRound, UsersRound } from 'lucide-react';

const fieldClass = 'mt-2 min-h-12 w-full rounded-xl border border-neutral-300 bg-neutral-100 px-4 py-3 text-sm text-neutral-600 placeholder:text-neutral-500';

/** Presentation only: recipient fields are deliberately disabled and no information is saved. */
export function RecipientLayoutPreview() {
  const [recipient, setRecipient] = useState<'myself' | 'someone-else'>('myself');
  return (
    <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="recipient-choice-heading" className="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8">
        <fieldset>
          <legend id="recipient-choice-heading" className="text-lg font-bold">Who would receive the delivery?</legend>
          <p className="mt-2 text-sm leading-6 text-neutral-600">Choose an option to explore the layout. This choice does not change your checkout.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-xl border p-4 ${recipient === 'myself' ? 'border-brand-red bg-red-50' : 'border-neutral-300 bg-white'}`}>
              <input type="radio" name="recipient-preview-choice" value="myself" checked={recipient === 'myself'} onChange={() => setRecipient('myself')} className="mt-1 accent-brand-red" />
              <UserRound size={20} className="shrink-0 text-brand-red" aria-hidden="true" />
              <span><span className="block text-sm font-bold">Myself</span><span className="mt-1 block text-xs leading-5 text-neutral-600">The buyer is also the recipient.</span></span>
            </label>
            <label className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-xl border p-4 ${recipient === 'someone-else' ? 'border-brand-red bg-red-50' : 'border-neutral-300 bg-white'}`}>
              <input type="radio" name="recipient-preview-choice" value="someone-else" checked={recipient === 'someone-else'} onChange={() => setRecipient('someone-else')} className="mt-1 accent-brand-red" />
              <UsersRound size={20} className="shrink-0 text-brand-red" aria-hidden="true" />
              <span><span className="block text-sm font-bold">Someone else</span><span className="mt-1 block text-xs leading-5 text-neutral-600">The recipient is not the buyer.</span></span>
            </label>
          </div>
        </fieldset>

        <div className="mt-8 border-t border-neutral-200 pt-6">
          <h2 className="text-lg font-bold">Recipient details layout</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600">{recipient === 'myself' ? 'A recipient record would still be needed when ordering for yourself.' : 'The recipient’s contact and destination would be separate from the buyer’s account.'} Fields are disabled in this preview.</p>
          <fieldset disabled className="mt-5 grid gap-5 sm:grid-cols-2">
            <legend className="sr-only">Unavailable recipient detail fields</legend>
            <div><label htmlFor="preview-recipient-name" className="text-sm font-bold">Recipient name</label><input id="preview-recipient-name" className={fieldClass} placeholder="Not available in preview" /></div>
            <div><label htmlFor="preview-recipient-phone" className="text-sm font-bold">Recipient phone</label><input id="preview-recipient-phone" type="tel" className={fieldClass} placeholder="Not available in preview" /></div>
            <div><label htmlFor="preview-recipient-city" className="text-sm font-bold">Destination city</label><input id="preview-recipient-city" className={fieldClass} placeholder="Not available in preview" /></div>
            <div className="sm:col-span-2"><label htmlFor="preview-recipient-address" className="text-sm font-bold">Delivery address</label><textarea id="preview-recipient-address" rows={3} className={fieldClass} placeholder="Not available in preview" /></div>
            <div className="sm:col-span-2"><label htmlFor="preview-recipient-notes" className="text-sm font-bold">Delivery instructions <span className="font-normal text-neutral-600">(optional)</span></label><textarea id="preview-recipient-notes" rows={2} className={fieldClass} placeholder="Not available in preview" /></div>
          </fieldset>
        </div>
      </section>
      <aside aria-labelledby="destination-preview-heading" className="rounded-2xl border border-[#eee4d8] bg-[#faf5ee] p-6">
        <span className="inline-flex rounded-xl bg-white p-3 text-brand-red"><MapPin size={21} aria-hidden="true" /></span>
        <h2 id="destination-preview-heading" className="mt-4 text-lg font-bold">Destination matters</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-700">The intended checkout design uses the recipient’s destination for serviceability, including when the buyer is elsewhere.</p>
        <p className="mt-4 border-t border-[#eee4d8] pt-4 text-sm leading-6 text-neutral-700">This preview does not request location, check an address, reserve stock or place an order.</p>
      </aside>
    </div>
  );
}
