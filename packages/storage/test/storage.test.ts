import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalEncryptedObjectStorage, signStorageToken, verifyStorageToken } from '../src/index';
const key = 'd'.repeat(64);
describe('private storage', () => {
  it('encrypts at rest and round-trips', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gs-storage-'));
    try { const s = new LocalEncryptedObjectStorage(dir, key); const data = Buffer.from('kyc-secret'); const meta = await s.put('kyc/a', data, 'image/png'); expect(meta.sha256).toHaveLength(64); expect((await s.get('kyc/a')).equals(data)).toBe(true); await s.delete('kyc/a'); await expect(s.get('kyc/a')).rejects.toThrow(); } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects path traversal and tampered tokens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gs-storage-'));
    try { const s = new LocalEncryptedObjectStorage(dir, key); await expect(s.put('../escape', Buffer.from('x'), 'text/plain')).rejects.toThrow(); const token = signStorageToken({ objectId: 'obj', action: 'download', exp: Date.now() + 60000 }, key); expect(verifyStorageToken(token, key).objectId).toBe('obj'); expect(() => verifyStorageToken(token + 'x', key)).toThrow(); expect(() => verifyStorageToken(signStorageToken({ objectId: 'obj', action: 'download', exp: 1 }, key), key)).toThrow(); } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
