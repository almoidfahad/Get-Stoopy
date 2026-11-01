import { describe, expect, it } from 'vitest';
import { addMoney, allocateProRata, assertBalanced, commissionBps } from '../src/index.js';
describe('money', () => {
  it('adds same currency', () => expect(addMoney({ amountMinor: 100, currency: 'BDT' }, { amountMinor: 50, currency: 'BDT' }).amountMinor).toBe(150));
  it('rejects currency mismatch', () => expect(() => addMoney({ amountMinor: 1, currency: 'BDT' }, { amountMinor: 1, currency: 'USD' })).toThrow('CURRENCY_MISMATCH'));
  it('rejects floating minor units', () => expect(() => allocateProRata({ amountMinor: 10.5, currency: 'BDT' }, [1])).toThrow());
  it('allocates remainder deterministically and exactly', () => { const a = allocateProRata({ amountMinor: 100, currency: 'BDT' }, [1, 1, 1]); expect(a.map(x => x.amountMinor)).toEqual([34, 33, 33]); expect(a.reduce((s, x) => s + x.amountMinor, 0)).toBe(100); });
  it('balances journal', () => expect(() => assertBalanced([{ accountId: 'a', side: 'DEBIT', amountMinor: 100, currency: 'BDT' }, { accountId: 'b', side: 'CREDIT', amountMinor: 100, currency: 'BDT' }])).not.toThrow());
  it('rejects unbalanced journal', () => expect(() => assertBalanced([{ accountId: 'a', side: 'DEBIT', amountMinor: 100, currency: 'BDT' }, { accountId: 'b', side: 'CREDIT', amountMinor: 99, currency: 'BDT' }])).toThrow('UNBALANCED_BDT'));
  it('rejects zero line', () => expect(() => assertBalanced([{ accountId: 'a', side: 'DEBIT', amountMinor: 0, currency: 'BDT' }, { accountId: 'b', side: 'CREDIT', amountMinor: 0, currency: 'BDT' }])).toThrow());
  it('rounds commission half-up in basis points', () => expect(commissionBps({ amountMinor: 100000, currency: 'BDT' }, 1000).amountMinor).toBe(10000));
});
