import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FinanceService } from '../../../apps/api/src/finance/finance.service';

const countryId = 'country';
const deposit = { id: 'deposit', riderId: 'rider', countryId, currency: 'BDT', amountMinor: 1000n, externalReference: 'Bank Ref-42', status: 'PENDING_REVIEW', version: 1, submittedByUserId: 'submitter', reviewCommandKey: null };
const ctx = { userId: 'reviewer', authorizationVersion: 1, permissions: ['finance:cod:review'], assurance: 'STEP_UP', scopes: [{ type: 'COUNTRY', countryId }], now: new Date().toISOString() } as any;
const input = { expectedVersion: 1, decision: 'VERIFY' as const, commandKey: 'review-command', reason: 'trusted reference matched' };

function fixture(dep: any = deposit, duplicate: any = { id: 'some-other-deposit' }) {
  const tx = { $executeRaw: vi.fn().mockResolvedValue(1), $queryRaw: vi.fn().mockResolvedValue([dep]), codDeposit: { findFirst: vi.fn().mockResolvedValue(duplicate), update: vi.fn() }, codAllocation: { aggregate: vi.fn(), create: vi.fn() } };
  const service = new FinanceService({ $transaction: (fn: any) => fn(tx) } as any);
  return { service, tx };
}

describe('COD deposit reference replay boundary', () => {
  it('locks the country and exact reference before checking verified deposits across riders and methods', async () => {
    const { service, tx } = fixture();
    await expect(service.reviewDeposit(ctx, deposit.id, input)).rejects.toMatchObject({ status: 409, response: { code: 'COD_DEPOSIT_REFERENCE_ALREADY_VERIFIED' } });
    const lock = tx.$executeRaw.mock.calls[3];
    expect(lock[0].join('?')).toContain('pg_advisory_xact_lock');
    expect(lock[1]).toBe(`cod-deposit-reference:${JSON.stringify([countryId, deposit.externalReference])}`);
    expect(tx.codDeposit.findFirst).toHaveBeenCalledWith({ where: { countryId, externalReference: deposit.externalReference, status: 'VERIFIED', id: { not: deposit.id } }, select: { id: true } });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(4); // RLS and reference lock; no rider lock or ledger writes
    expect(tx.codDeposit.update).not.toHaveBeenCalled(); expect(tx.codAllocation.create).not.toHaveBeenCalled();
  });
  it('keeps authorization before the reference lookup', async () => {
    const { service, tx } = fixture();
    await expect(service.reviewDeposit({ ...ctx, permissions: [] }, deposit.id, input)).rejects.toMatchObject({ status: 403 });
    expect(tx.codDeposit.findFirst).not.toHaveBeenCalled(); expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
  });
  it('replays a previously verified review before the collision check', async () => {
    const payloadHash = createHash('sha256').update(JSON.stringify({ id: deposit.id, expectedVersion: 1, decision: 'VERIFY', reason: input.reason })).digest('hex');
    const { service, tx } = fixture({ ...deposit, status: 'VERIFIED', reviewCommandKey: input.commandKey, reviewPayloadHash: payloadHash, method: 'BANK', version: 2, journalId: 'journal' });
    const result = await service.reviewDeposit(ctx, deposit.id, input);
    expect(result).toMatchObject({ depositId: deposit.id, status: 'VERIFIED', duplicate: true });
    expect(tx.codDeposit.findFirst).not.toHaveBeenCalled();
  });
  it('allows rejecting a pending deposit without reference locking or allocation', async () => {
    const { service, tx } = fixture();
    tx.codDeposit.update.mockResolvedValue({ ...deposit, status: 'REJECTED', method: 'BANK', journalId: null });
    vi.spyOn(service as any, 'audit').mockResolvedValue(undefined);
    const result = await service.reviewDeposit(ctx, deposit.id, { ...input, decision: 'REJECT' });
    expect(result).toMatchObject({ status: 'REJECTED' });
    expect(tx.codDeposit.findFirst).not.toHaveBeenCalled(); expect(tx.$executeRaw).toHaveBeenCalledTimes(3); expect(tx.codAllocation.create).not.toHaveBeenCalled();
  });
});
