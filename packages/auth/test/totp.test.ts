import { describe, it, expect } from 'vitest';
import { base32Encode, base32Decode, hotp, totp, verifyTotp, generateTotpSecret, otpauthUri, generateRecoveryCodes } from '../src/totp';
describe('TOTP', () => {
  it('round-trips base32', () => { const b = Buffer.from('12345678901234567890'); expect(base32Decode(base32Encode(b)).equals(b)).toBe(true); });
  it('matches RFC 6238 SHA1 vector at 59s', () => { const secret = base32Encode(Buffer.from('12345678901234567890')); expect(totp(secret, 59_000, 30, 8)).toBe('94287082'); });
  it('accepts current code and rejects replay', () => { const secret = generateTotpSecret(); const time = 1_800_000_000_000; const code = totp(secret, time); const first = verifyTotp(secret, code, { time, lastUsedCounter: -1 }); expect(first).toBeTruthy(); expect(verifyTotp(secret, code, { time, lastUsedCounter: first!.counter })).toBeNull(); });
  it('rejects malformed codes', () => { const secret = generateTotpSecret(); expect(verifyTotp(secret, 'abc', {})).toBeNull(); });
  it('builds otpauth URI and recovery codes', () => { expect(otpauthUri({ issuer: 'Get Stoopy', account: 'a@b.c', secret: 'ABC' })).toContain('otpauth://totp/'); expect(generateRecoveryCodes(10)).toHaveLength(10); });
});
