import { describe, expect, it } from 'vitest';
import { journalPayloadHash, validateJournalInput, type PostJournalInput } from '../src/index';

const actor = '00000000-0000-4000-8000-000000000001';
const a = '00000000-0000-4000-8000-000000000002';
const b = '00000000-0000-4000-8000-000000000003';
function input(): PostJournalInput {
  return { businessEventKey: 'evt-12345678', currency: 'BDT', description: 'test journal', createdByUserId: actor, lines: [{ accountId: a, side: 'DEBIT', amountMinor: 100n }, { accountId: b, side: 'CREDIT', amountMinor: 100n }] };
}

describe('ledger input validation', () => {
  it('accepts a balanced bigint journal', () => { expect(() => validateJournalInput(input())).not.toThrow(); });
  it('rejects unbalanced, zero/negative and non-bigint amounts', () => {
    expect(() => validateJournalInput({ ...input(), lines: [{ accountId: a, side: 'DEBIT', amountMinor: 100n }, { accountId: b, side: 'CREDIT', amountMinor: 99n }] })).toThrow('LEDGER_UNBALANCED');
    expect(() => validateJournalInput({ ...input(), lines: [{ accountId: a, side: 'DEBIT', amountMinor: 0n }, { accountId: b, side: 'CREDIT', amountMinor: 0n }] })).toThrow('LEDGER_AMOUNT_INVALID');
    expect(() => validateJournalInput({ ...input(), lines: [{ accountId: a, side: 'DEBIT', amountMinor: 100 as unknown as bigint }, { accountId: b, side: 'CREDIT', amountMinor: 100 as unknown as bigint }] })).toThrow('LEDGER_AMOUNT_INVALID');
  });
  it('rejects invalid currency/side/line count', () => {
    expect(() => validateJournalInput({ ...input(), currency: 'bdt' })).toThrow('LEDGER_CURRENCY_INVALID');
    expect(() => validateJournalInput({ ...input(), lines: [{ accountId: a, side: 'DEBIT', amountMinor: 100n }] })).toThrow('LEDGER_LINES_INVALID');
    expect(() => validateJournalInput({ ...input(), lines: [{ accountId: a, side: 'LEFT' as never, amountMinor: 100n }, { accountId: b, side: 'CREDIT', amountMinor: 100n }] })).toThrow('LEDGER_SIDE_INVALID');
  });
  it('hashes canonical payload deterministically', () => {
    const x = input(); const y = input();
    expect(journalPayloadHash(x)).toBe(journalPayloadHash(y));
    expect(journalPayloadHash({ ...x, description: 'different' })).not.toBe(journalPayloadHash(x));
  });
});
