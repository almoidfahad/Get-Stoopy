import { describe, expect, it, vi } from 'vitest';
import { assertLegacyCodCollectionSafe } from '../../../apps/api/src/finance/cod-collection-safety';
import { FinanceService } from '../../../apps/api/src/finance/finance.service';
import { DeliveryService } from '../../../apps/api/src/delivery/delivery.service';

const suborder = { id: 'sub-a', orderId: 'order', currency: 'BDT', subtotalMinor: 1000n, order: { paymentMethod: 'COD', paymentStatus: 'AWAITING_COD', pricingScope: 'PRODUCT_SUBTOTAL_ONLY', amountMinor: 1000n, currency: 'BDT' }, version: 1 };
const denied = { status: 409, response: { code: 'COD_ALLOCATION_REQUIRED' } };

describe('legacy COD collection boundary', () => {
  it('permits only a matching single-suborder legacy subtotal snapshot', async () => {
    const tx = { vendorSuborder: { findMany: vi.fn().mockResolvedValue([{ id: 'sub-a' }]) } };
    await expect(assertLegacyCodCollectionSafe(tx, suborder)).resolves.toBeUndefined();
    expect(tx.vendorSuborder.findMany).toHaveBeenCalledWith({ where: { orderId: 'order' }, select: { id: true }, take: 2 });
    for (const bad of [
      { ...suborder, subtotalMinor: 999n },
      { ...suborder, currency: 'USD' },
      { ...suborder, order: { ...suborder.order, pricingScope: 'FINAL_TOTAL' } },
      { ...suborder, id: 'different' },
    ]) await expect(assertLegacyCodCollectionSafe(tx, bad)).rejects.toMatchObject(denied);
    for (const siblings of [[], [{ id: 'sub-a' }, { id: 'sub-b' }]]) {
      tx.vendorSuborder.findMany.mockResolvedValueOnce(siblings);
      await expect(assertLegacyCodCollectionSafe(tx, suborder)).rejects.toMatchObject(denied);
    }
  });

  it('denies delivery completion before status or accounting writes', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      deliveryProof: { findUnique: vi.fn().mockResolvedValue({ id: 'proof' }) },
      riderAssignment: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'assignment' }), update: vi.fn() },
      vendorSuborder: { findUniqueOrThrow: vi.fn().mockResolvedValue(suborder), findMany: vi.fn().mockResolvedValue([{ id: 'sub-a' }, { id: 'sub-b' }]), update: vi.fn() },
      delivery: { update: vi.fn() },
    };
    const finance = { recordCompletionTx: vi.fn() };
    const service = new DeliveryService({ $transaction: (fn: any) => fn(tx) } as any, {} as any, {} as any, finance as any, {} as any);
    vi.spyOn(service as any, 'lockDelivery').mockResolvedValue({ riderId: 'rider', status: 'DELIVERED', version: 2, assignmentId: 'assignment', suborderId: 'sub-a' });
    await expect(service.complete({ userId: 'user', riderId: 'rider', authorizationVersion: 1 } as any, 'delivery', { expectedVersion: 2, commandKey: 'complete-command' })).rejects.toMatchObject(denied);
    expect(tx.delivery.update).not.toHaveBeenCalled();
    expect(tx.riderAssignment.update).not.toHaveBeenCalled();
    expect(tx.vendorSuborder.update).not.toHaveBeenCalled();
    expect(finance.recordCompletionTx).not.toHaveBeenCalled();
  });

  it('also rejects at the finance entry point before any journal or earning writes', async () => {
    const tx = {
      delivery: { findUniqueOrThrow: vi.fn().mockResolvedValue({ suborderId: 'sub-a' }) },
      vendorSuborder: { findUniqueOrThrow: vi.fn().mockResolvedValue(suborder), findMany: vi.fn().mockResolvedValue([{ id: 'sub-a' }, { id: 'sub-b' }]) },
      riderRateSnapshot: { findUnique: vi.fn() },
      riderEarning: { create: vi.fn() }, codCollection: { create: vi.fn() },
    };
    const service = new FinanceService({} as any);
    const journal = vi.spyOn(service, 'postJournalTx');
    await expect(service.recordCompletionTx(tx, { id: 'delivery', assignmentId: 'assignment', riderId: 'rider', countryId: 'country' }, 'actor')).rejects.toMatchObject(denied);
    expect(tx.riderRateSnapshot.findUnique).not.toHaveBeenCalled();
    expect(tx.riderEarning.create).not.toHaveBeenCalled(); expect(tx.codCollection.create).not.toHaveBeenCalled(); expect(journal).not.toHaveBeenCalled();
  });
});
