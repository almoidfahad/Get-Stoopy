import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { StorageService } from '../../../apps/api/src/storage/storage.service.js';

const id = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const reviewer = '33333333-3333-4333-8333-333333333333';
const ctx = { userId: reviewer, sessionId: '44444444-4444-4444-8444-444444444444', authorizationVersion: 1, assurance: 'STEP_UP', permissions: ['storage:kyc:review'] } as any;

function setup(row: { ownerUserId: string; purpose: string; state: string } | null) {
  const events: string[] = [];
  const tx = {
    $executeRaw: vi.fn().mockImplementation(async () => { events.push('execute'); return 0; }),
    $queryRaw: vi.fn().mockImplementation(async () => { events.push('lock'); return row ? [row] : []; }),
    storageObject: { update: vi.fn().mockImplementation(async ({ data }: any) => { events.push('update'); return { ...data }; }) },
  };
  const privileged = { $transaction: vi.fn(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx)) };
  return { tx, events, service: new StorageService({} as any, privileged as any, { STORAGE_LOCAL_DIR: '.local/test', STORAGE_ENCRYPTION_KEY: 'e'.repeat(64) } as any) };
}
const quarantined = { ownerUserId: owner, purpose: 'kyc-document', state: 'QUARANTINED' };
describe('KYC object review serialization', () => {
  it('locks the object before updating and recording the decision', async () => {
    const { tx, service, events } = setup(quarantined);
    await expect(service.review(ctx, id, { decision: 'approve', reason: 'document is readable' })).resolves.toMatchObject({ objectId: id, state: 'UPLOADED' });
    const [strings, ...values] = tx.$queryRaw.mock.calls[0]!;
    expect((strings as unknown as TemplateStringsArray).join('?')).toMatch(/"StorageObject".*FOR UPDATE/s);
    expect(values).toEqual([id]);
    expect(events.indexOf('lock')).toBeLessThan(events.indexOf('update'));
    expect(events.at(-1)).toBe('execute');
  });
  it.each([
    [null, 404, 'OBJECT_NOT_FOUND'],
    [{ ...quarantined, purpose: 'product-image' }, 404, 'OBJECT_NOT_FOUND'],
    [{ ...quarantined, ownerUserId: reviewer }, 403, 'SELF_REVIEW_DENIED'],
    [{ ...quarantined, state: 'UPLOADED' }, 400, 'OBJECT_NOT_QUARANTINED'],
    [{ ...quarantined, state: 'DELETED' }, 400, 'OBJECT_NOT_QUARANTINED'],
  ] as const)('does not update an ineligible object', async (row, status, code) => {
    const { tx, service } = setup(row);
    await expect(service.review(ctx, id, { decision: 'reject', reason: 'document unreadable' })).rejects.toMatchObject({ status, response: { code } });
    expect(tx.storageObject.update).not.toHaveBeenCalled();
  });
});
