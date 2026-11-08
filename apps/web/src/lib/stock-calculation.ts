import { availableToPromise, MAX_STOCK_UNITS } from '@getstoopy/core/browser';

export type StockCalculation =
  | { status: 'incomplete' }
  | { status: 'invalid'; field: 'onHand' | 'reserved'; message: string }
  | { status: 'ready'; available: number };

/** Calculator only; does not read or update live inventory. */
export function calculateStock(onHand: string, reserved: string): StockCalculation {
  for (const [field, value] of [['onHand', onHand], ['reserved', reserved]] as const) {
    if (value !== '' && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > MAX_STOCK_UNITS)) {
      return { status: 'invalid', field, message: `Enter a whole number between 0 and ${MAX_STOCK_UNITS.toLocaleString('en-US')}.` };
    }
  }
  if (onHand === '' || reserved === '') return { status: 'incomplete' };
  if (Number(reserved) > Number(onHand)) return { status: 'invalid', field: 'reserved', message: 'Reserved units cannot exceed on-hand units.' };
  return { status: 'ready', available: availableToPromise(Number(onHand), Number(reserved)) };
}
