'use client';

import { useState } from 'react';
import { Calculator } from 'lucide-react';
import { calculateStock } from '@/lib/stock-calculation';

const inputClass = 'mt-2 block w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm text-neutral-950 outline-none focus:border-brand-red focus:ring-2 focus:ring-red-200';

export function StockCalculator() {
  const [onHand, setOnHand] = useState('');
  const [reserved, setReserved] = useState('');
  const result = calculateStock(onHand, reserved);
  const onHandError = result.status === 'invalid' && result.field === 'onHand';
  const reservedError = result.status === 'invalid' && result.field === 'reserved';
  return (
    <section aria-labelledby="stock-calculator-heading" className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-red-50 p-2.5 text-brand-red"><Calculator size={20} aria-hidden="true" /></span><div><h2 id="stock-calculator-heading" className="text-lg font-bold">Stock calculation</h2><p className="mt-1 text-sm text-neutral-600">Try the on-hand minus reserved calculation.</p></div></div>
      <div role="note" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-neutral-800"><strong>Calculation only, not live inventory.</strong> Entries are not saved or sent to the store and disappear when you leave or reload. Do not enter sensitive information.</div>
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div><label htmlFor="stock-on-hand" className="text-sm font-bold">On-hand units</label><input id="stock-on-hand" type="text" inputMode="numeric" autoComplete="off" maxLength={16} value={onHand} onChange={event => setOnHand(event.target.value)} className={inputClass} aria-describedby={onHandError ? 'stock-on-hand-help stock-on-hand-error' : 'stock-on-hand-help'} aria-invalid={onHandError || undefined} /><p id="stock-on-hand-help" className="mt-2 text-xs leading-5 text-neutral-600">Whole units physically on hand.</p>{onHandError && <p id="stock-on-hand-error" className="mt-1 text-xs font-semibold text-brand-red">{result.message}</p>}</div>
        <div><label htmlFor="stock-reserved" className="text-sm font-bold">Reserved units</label><input id="stock-reserved" type="text" inputMode="numeric" autoComplete="off" maxLength={16} value={reserved} onChange={event => setReserved(event.target.value)} className={inputClass} aria-describedby={reservedError ? 'stock-reserved-help stock-reserved-error' : 'stock-reserved-help'} aria-invalid={reservedError || undefined} /><p id="stock-reserved-help" className="mt-2 text-xs leading-5 text-neutral-600">Whole units reserved for orders.</p>{reservedError && <p id="stock-reserved-error" className="mt-1 text-xs font-semibold text-brand-red">{result.message}</p>}</div>
      </div>
      <div className="mt-6 rounded-xl bg-neutral-950 p-5 text-white" aria-live="polite" aria-atomic="true"><p className="text-xs font-bold uppercase tracking-[.12em] text-neutral-300">Calculated available units</p><p className="mt-2 text-2xl font-black">{result.status === 'ready' ? result.available.toLocaleString('en-US') : '—'}</p><p className="mt-2 text-xs leading-5 text-neutral-300">{result.status === 'ready' ? 'Calculated from your entries only; not a live stock figure.' : result.status === 'invalid' ? 'Correct the highlighted entry to calculate.' : 'Enter both quantities to calculate.'}</p></div>
    </section>
  );
}
