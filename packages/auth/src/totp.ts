import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const c of clean) { const idx = ALPHABET.indexOf(c); if (idx < 0) throw new Error('INVALID_BASE32'); value = (value << 5) | idx; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function generateTotpSecret(bytes = 20): string { if (bytes < 16) throw new Error('TOTP_SECRET_TOO_SHORT'); return base32Encode(randomBytes(bytes)); }
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new Error('INVALID_COUNTER');
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(buf).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = ((digest[offset]! & 0x7f) << 24 | digest[offset + 1]! << 16 | digest[offset + 2]! << 8 | digest[offset + 3]!) % 10 ** digits;
  return String(code).padStart(digits, '0');
}
export function totp(secretBase32: string, time = Date.now(), period = 30, digits = 6): string { return hotp(base32Decode(secretBase32), Math.floor(time / 1000 / period), digits); }
export interface TotpVerifyOptions { time?: number; period?: number; digits?: number; window?: number; lastUsedCounter?: number; }
export function verifyTotp(secretBase32: string, code: string, opts: TotpVerifyOptions = {}): { counter: number } | null {
  const period = opts.period ?? 30, digits = opts.digits ?? 6, window = opts.window ?? 1;
  if (!/^\d{6}$|^\d{8}$/.test(code)) return null;
  const secret = base32Decode(secretBase32); const current = Math.floor((opts.time ?? Date.now()) / 1000 / period);
  for (let offset = -window; offset <= window; offset++) {
    const counter = current + offset; if (counter < 0) continue;
    if (opts.lastUsedCounter !== undefined && counter <= opts.lastUsedCounter) continue;
    const expected = hotp(secret, counter, digits);
    const a = Buffer.from(expected), b = Buffer.from(code.padStart(digits, '0'));
    if (a.length === b.length && timingSafeEqual(a, b)) return { counter };
  }
  return null;
}
export function otpauthUri(input: { issuer: string; account: string; secret: string; digits?: number; period?: number }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({ secret: input.secret, issuer: input.issuer, algorithm: 'SHA1', digits: String(input.digits ?? 6), period: String(input.period ?? 30) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
export function generateRecoveryCodes(count = 10): string[] { return Array.from({ length: count }, () => randomBytes(10).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toUpperCase()); }
