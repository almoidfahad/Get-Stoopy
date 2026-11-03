export * from './content-type.js';
import { createCipheriv, createDecipheriv, createHash, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
export interface StoredObject { key: string; sizeBytes: number; sha256: string; encryptionKeyId: string; }
export interface ObjectStorage {
  put(key: string, data: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
export interface StorageTokenPayload { objectId: string; action: 'upload' | 'download' | 'review-download'; exp: number; }
export function signStorageToken(payload: StorageTokenPayload, hexKey: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', Buffer.from(hexKey, 'hex')).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyStorageToken(token: string, hexKey: string, now = Date.now()): StorageTokenPayload {
  const [body, sig] = token.split('.');
  if (!body || !sig) throw new Error('STORAGE_TOKEN_INVALID');
  const expected = createHmac('sha256', Buffer.from(hexKey, 'hex')).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('STORAGE_TOKEN_INVALID');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StorageTokenPayload;
  if (!payload.objectId || !['upload','download','review-download'].includes(payload.action) || payload.exp <= now) throw new Error('STORAGE_TOKEN_EXPIRED');
  return payload;
}
export class LocalEncryptedObjectStorage implements ObjectStorage {
  constructor(private readonly root: string, private readonly hexKey: string, private readonly keyId = 'local-dev-aes-256-gcm') {
    if (!/^[0-9a-f]{64}$/i.test(hexKey)) throw new Error('INVALID_STORAGE_KEY');
    const n = normalize(root); if (n.startsWith('..')) throw new Error('INVALID_STORAGE_ROOT');
  }
  private path(key: string): string { const n = normalize(key); if (n.startsWith('..') || n.includes('\0')) throw new Error('INVALID_OBJECT_KEY'); return join(this.root, n); }
  async put(key: string, data: Buffer, _contentType: string): Promise<StoredObject> {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(this.hexKey, 'hex'), iv);
    const enc = Buffer.concat([cipher.update(data), cipher.final()]); const tag = cipher.getAuthTag();
    const file = Buffer.concat([Buffer.from([1]), iv, tag, enc]);
    const p = this.path(key); await mkdir(dirname(p), { recursive: true }); await writeFile(p, file, { mode: 0o600 });
    return { key, sizeBytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), encryptionKeyId: this.keyId };
  }
  async get(key: string): Promise<Buffer> {
    const file = await readFile(this.path(key));
    if (file[0] !== 1 || file.length < 29) throw new Error('STORAGE_ENVELOPE_INVALID');
    const iv = file.subarray(1, 13), tag = file.subarray(13, 29), enc = file.subarray(29);
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(this.hexKey, 'hex'), iv); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]);
  }
  async delete(key: string): Promise<void> {
    try { await unlink(this.path(key)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
}
