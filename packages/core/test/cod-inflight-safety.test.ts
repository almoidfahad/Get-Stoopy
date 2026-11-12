import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { dispatchOfferToken, dispatchOfferTokenHash } from '../src/dispatch';
import { DispatchService } from '../../../apps/api/src/dispatch/dispatch.service';
import { DeliveryService } from '../../../apps/api/src/delivery/delivery.service';

const secret = 'synthetic-secret-at-least-32-chars';
const rider = { userId: 'user', riderId: 'rider', authorizationVersion: 1 } as any;
const suborder = { id: 'sub-a', orderId: 'order', currency: 'BDT', subtotalMinor: 1000n, order: { paymentMethod: 'COD', pricingScope: 'PRODUCT_SUBTOTAL_ONLY', amountMinor: 2000n, currency: 'BDT' } };
const denied = { status: 409, response: { code: 'COD_ALLOCATION_REQUIRED' } };
const run = { id: 'run', suborderId: 'sub-a', status: 'OFFERING', version: 1, attemptCount: 1, maxAttempts: 5 };
const token = dispatchOfferToken(secret, 'offer');
const openOffer = { id: 'offer', riderId: 'rider', runId: 'run', offerTokenHash: dispatchOfferTokenHash(token), status: 'OFFERED', expiresAt: new Date(Date.now() + 60_000) };
const vendorSuborder = () => ({ findUniqueOrThrow: vi.fn().mockResolvedValue(suborder), findMany: vi.fn().mockResolvedValue([{ id: 'sub-a' }, { id: 'sub-b' }]) });

function dispatchFixture(offer: any = openOffer) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValueOnce([offer]).mockResolvedValueOnce([{ id: 'rider' }]).mockResolvedValueOnce([{ now: new Date() }]),
    dispatchOffer: { findUnique: vi.fn().mockResolvedValue({ riderId: 'rider', runId: 'run' }) },
    dispatchRun: { update: vi.fn() }, vendorSuborder: vendorSuborder(),
  };
  const finance = { snapshotRateTx: vi.fn() };
  const service = new DispatchService({ $transaction: (fn: any) => fn(tx) } as any, { DISPATCH_OFFER_TOKEN_SECRET: secret } as any, finance as any);
  vi.spyOn(service as any, 'lockRun').mockResolvedValue(run);
  return { tx, service, finance };
}

describe('in-flight COD allocation safeguards', () => {
  it('blocks new offers for an old searching run before routing, state updates or events', async () => {
    const { tx, service } = dispatchFixture();
    vi.spyOn(service as any, 'lockRun').mockResolvedValue({ ...run, status: 'SEARCHING', attemptCount: 0 });
    vi.spyOn(service as any, 'requireRunAdmin').mockResolvedValue(undefined);
    tx.dispatchOffer.findUnique.mockResolvedValue(null);
    await expect(service.nextOffer(rider, 'run', { expectedVersion: 1, commandKey: 'next-offer-1' })).rejects.toMatchObject(denied);
    expect(tx.vendorSuborder.findMany).toHaveBeenCalledOnce();
    expect(tx.dispatchRun.update).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('blocks accepting an old open offer after token verification and before assignment writes', async () => {
    const { tx, service, finance } = dispatchFixture();
    await expect(service.acceptOffer(rider, 'offer', { offerToken: token, commandKey: 'accept-offer-1' })).rejects.toMatchObject(denied);
    expect(tx.vendorSuborder.findMany).toHaveBeenCalledOnce();
    expect(tx.dispatchRun.update).not.toHaveBeenCalled(); expect(finance.snapshotRateTx).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3); // RLS setup only
  });

  it('continues to allow rejection of an old offer for recovery', async () => {
    const { tx, service } = dispatchFixture();
    vi.spyOn(service as any, 'event').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'audit').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'outbox').mockResolvedValue(undefined);
    const result = await service.rejectOffer(rider, 'offer', { offerToken: token, commandKey: 'reject-offer-1', reason: 'rider declines legacy offer' });
    expect(result).toMatchObject({ status: 'REJECTED', duplicate: false });
    expect(tx.vendorSuborder.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.dispatchRun.update).toHaveBeenCalledOnce();
  });

  it('preserves accepted-offer idempotent replay without creating a new assignment', async () => {
    const key = 'accept-offer-1';
    const payloadHash = createHash('sha256').update(JSON.stringify({ action: 'accept', offerTokenHash: dispatchOfferTokenHash(token), reason: null })).digest('hex');
    const { tx, service, finance } = dispatchFixture({ ...openOffer, status: 'ACCEPTED', responseCommandKey: key, responsePayloadHash: payloadHash });
    await expect(service.acceptOffer(rider, 'offer', { offerToken: token, commandKey: key })).resolves.toMatchObject({ status: 'ACCEPTED', duplicate: true });
    expect(tx.vendorSuborder.findUniqueOrThrow).not.toHaveBeenCalled(); expect(finance.snapshotRateTx).not.toHaveBeenCalled();
  });

  it('blocks pickup for an old assignment before recipient lookup or delivery creation', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1), vendorSuborder: vendorSuborder(), delivery: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() }, deliveryRecipient: { findUnique: vi.fn() } };
    const service = new DeliveryService({ $transaction: (fn: any) => fn(tx) } as any, {} as any, {} as any, {} as any, {} as any);
    vi.spyOn(service as any, 'lockAssignment').mockResolvedValue({ riderId: 'rider', status: 'ACTIVE', suborderStatus: 'READY_FOR_PICKUP', suborderId: 'sub-a', orderId: 'order' });
    await expect(service.confirmPickup(rider, 'assignment', { commandKey: 'pickup-command' })).rejects.toMatchObject(denied);
    expect(tx.deliveryRecipient.findUnique).not.toHaveBeenCalled(); expect(tx.delivery.create).not.toHaveBeenCalled();
  });

  it('preserves a previously confirmed pickup replay and enforces rider ownership first', async () => {
    const key = 'pickup-command';
    const pickupPayloadHash = createHash('sha256').update(JSON.stringify({ assignmentId: 'assignment' })).digest('hex');
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1), vendorSuborder: vendorSuborder(), delivery: { findUnique: vi.fn().mockResolvedValue({ id: 'delivery', pickupCommandKey: key, pickupPayloadHash, status: 'PICKED_UP', version: 1 }) } };
    const service = new DeliveryService({ $transaction: (fn: any) => fn(tx) } as any, {} as any, {} as any, {} as any, {} as any);
    const lock = vi.spyOn(service as any, 'lockAssignment').mockResolvedValue({ riderId: 'rider' });
    await expect(service.confirmPickup(rider, 'assignment', { commandKey: key })).resolves.toMatchObject({ deliveryId: 'delivery', duplicate: true });
    expect(tx.vendorSuborder.findUniqueOrThrow).not.toHaveBeenCalled();
    lock.mockResolvedValue({ riderId: 'other-rider' });
    await expect(service.confirmPickup(rider, 'assignment', { commandKey: key })).rejects.toMatchObject({ status: 404, response: { code: 'ASSIGNMENT_NOT_FOUND' } });
    expect(tx.delivery.findUnique).toHaveBeenCalledTimes(1);
  });
});
