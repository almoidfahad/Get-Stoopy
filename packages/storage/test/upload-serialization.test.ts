import 'reflect-metadata';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalEncryptedObjectStorage, signStorageToken } from '@getstoopy/storage';
import { StorageService } from '../../../apps/api/src/storage/storage.service.js';

const key = 'e'.repeat(64);
const id = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const context = { userId: owner, sessionId: '33333333-3333-4333-8333-333333333333', authorizationVersion: 1 } as any;
const bytes = Buffer.from('%PDF-1.4 test bytes');
const token = signStorageToken({ objectId: id, action: 'upload', exp: Date.now() + 60000 }, key);
afterEach(() => vi.restoreAllMocks());
function setup(state: 'PENDING_UPLOAD' | 'QUARANTINED' | 'MISSING') {
  const obj = { id, state, sizeBytes: BigInt(bytes.length), contentType: 'application/pdf', objectKey: 'kyc-document/test', purpose: 'kyc-document' };
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue(state === 'MISSING' ? [] : [obj]),
    storageObject: { update: vi.fn().mockResolvedValue({}) },
  };
  const db = { $transaction: vi.fn(async (callback: (tx: typeof tx) => Promise<unknown>) => callback(tx)) };
  const service = new StorageService(db as any, {} as any, { STORAGE_LOCAL_DIR: '.local/test', STORAGE_ENCRYPTION_KEY: key } as any);
  const put = vi.spyOn(LocalEncryptedObjectStorage.prototype, 'put').mockResolvedValue({ key: obj.objectKey, sizeBytes: bytes.length, sha256: 'a'.repeat(64), encryptionKeyId: 'test' });
  return { tx, service, put };
}

describe('upload row locking', () => {
  it('locks the owner-scoped row before writing the object', async () => {
    const { tx, service, put } = setup('PENDING_UPLOAD');
    const result = await service.upload(context, id, token, Readable.from([bytes]) as any);
    expect(result).toEqual({ objectId: id, state: 'QUARANTINED' });
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    const [strings, ...values] = tx.$queryRaw.mock.calls[0]!;
    expect((strings as unknown as TemplateStringsArray).join('?')).toMatch(/"StorageObject".*"ownerUserId".*FOR UPDATE/s);
    expect(values).toEqual([id, owner]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(put.mock.invocationCallOrder[0]!);
    expect(put).toHaveBeenCalledOnce();
    expect(tx.storageObject.update).toHaveBeenCalledOnce();
  });
  it.each([['QUARANTINED', 400, 'OBJECT_NOT_PENDING'], ['MISSING', 404, 'OBJECT_NOT_FOUND']] as const)('does not write a %s row', async (state, status, code) => {
    const { service, put, tx } = setup(state);
    await expect(service.upload(context, id, token, Readable.from([bytes]) as any)).rejects.toMatchObject({ status, response: { code } });
    expect(put).not.toHaveBeenCalled();
    expect(tx.storageObject.update).not.toHaveBeenCalled();
  });
});
