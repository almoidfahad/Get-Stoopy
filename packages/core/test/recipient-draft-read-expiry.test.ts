import { describe, expect, it, vi } from 'vitest';
import { encryptJson } from '@getstoopy/bff';
import { RecipientDraftService } from '../../../apps/api/src/commerce/recipient-draft.service';

const key = 'd'.repeat(64);
const cart = { id: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222', countryId: 'country', version: 1 };
const data = { cartId: cart.id, userId: cart.userId, cartVersion: 1, serviceZoneId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', boundaryVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', latitude: 24.7, longitude: 90.4, name: 'Synthetic Name', phone: '+8801712345678', addressLine: 'Synthetic address' };
const expiresAt = new Date('2030-01-01T00:00:00.000Z');
const ctx = { userId: cart.userId, authorizationVersion: 1 } as any;

function fixture() {
  const tx = { $executeRaw: vi.fn().mockResolvedValue(1), $queryRaw: vi.fn().mockResolvedValue([cart]), checkoutRecipientDraft: { findUnique: vi.fn().mockResolvedValue({ version: 2, envelope: Buffer.from(encryptJson(data, key)), expiresAt }) } };
  const transaction = vi.fn((fn: any) => fn(tx));
  const service = new RecipientDraftService({ $transaction: transaction } as any, { NODE_ENV: 'test', CHECKOUT_RECIPIENT_DRAFT_KEY: key } as any, {} as any);
  return { service, tx, transaction };
}

describe('test-only recipient draft read expiry', () => {
  it('returns the draft only while both checks are before expiry', async () => {
    const { service, transaction } = fixture();
    const clock = vi.spyOn(service as any, 'now').mockResolvedValueOnce(new Date(expiresAt.getTime() - 2)).mockResolvedValueOnce(new Date(expiresAt.getTime() - 1));
    expect(await service.read(ctx, cart.id)).toMatchObject({ state: 'DRAFT', draftVersion: 2, draft: { name: data.name, addressLine: data.addressLine }, quoteBound: false, coverageGuaranteed: false });
    expect(clock).toHaveBeenCalledTimes(2);
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead' });
  });
  it('returns no contact or location if expiry is reached during read', async () => {
    const { service } = fixture();
    const clock = vi.spyOn(service as any, 'now').mockResolvedValueOnce(new Date(expiresAt.getTime() - 1)).mockResolvedValueOnce(expiresAt);
    const result = await service.read(ctx, cart.id);
    expect(result).toEqual({ cartId: cart.id, draftVersion: 2, state: 'EXPIRED', draft: null });
    for (const secret of [data.name, data.phone, data.addressLine, String(data.latitude), String(data.longitude)]) expect(JSON.stringify(result)).not.toContain(secret);
    expect(clock).toHaveBeenCalledTimes(2);
  });
  it('does not decrypt when already expired', async () => {
    const { service } = fixture();
    const clock = vi.spyOn(service as any, 'now').mockResolvedValue(expiresAt);
    const decrypt = vi.spyOn(service as any, 'decrypt');
    expect(await service.read(ctx, cart.id)).toMatchObject({ state: 'EXPIRED', draft: null });
    expect(clock).toHaveBeenCalledOnce(); expect(decrypt).not.toHaveBeenCalled();
  });
  it('does not read a draft for a cart not owned by the caller', async () => {
    const { service, tx } = fixture(); tx.$queryRaw.mockResolvedValue([]);
    await expect(service.read(ctx, cart.id)).rejects.toMatchObject({ status: 404, response: { code: 'CART_NOT_FOUND' } });
    expect(tx.checkoutRecipientDraft.findUnique).not.toHaveBeenCalled();
  });
  it('remains disabled outside test before accessing the database', async () => {
    const db = { $transaction: vi.fn() };
    const service = new RecipientDraftService(db as any, { NODE_ENV: 'production', CHECKOUT_RECIPIENT_DRAFT_KEY: key } as any, {} as any);
    await expect(service.read(ctx, cart.id)).rejects.toMatchObject({ status: 503, response: { code: 'CHECKOUT_DRAFT_DISABLED' } });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
