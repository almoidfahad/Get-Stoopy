import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
export function encryptJson(value: unknown, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) throw new Error('INVALID_ENCRYPTION_KEY');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ v: 1, alg: 'A256GCM', iv: iv.toString('base64url'), tag: tag.toString('base64url'), data: data.toString('base64url') });
}
export function decryptJson<T>(envelope: string, hexKey: string): T {
  const key = Buffer.from(hexKey, 'hex');
  const parsed = JSON.parse(envelope) as { v: number; alg: string; iv: string; tag: string; data: string };
  if (parsed.v !== 1 || parsed.alg !== 'A256GCM') throw new Error('INVALID_ENVELOPE');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(parsed.data, 'base64url')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}
export function csrfTokenForSession(sessionToken: string): string {
  return createHmac('sha256', sessionToken).update('get-stoopy-csrf-v1').digest('base64url');
}
