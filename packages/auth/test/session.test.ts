import { describe, expect, it } from 'vitest';
import { constantTimeEqual, hashToken, newOpaqueToken, sessionExpiry, sessionValid, cookieOptions, sessionCookieName } from '../src/index.js';
import { assertRedirectAllowed, pkcePair, verifyPkce } from '../src/pkce.js';
describe('session primitives', () => {
  it('generates high-entropy unique opaque tokens', () => { const a = newOpaqueToken(), b = newOpaqueToken(); expect(a).not.toBe(b); expect(a.length).toBeGreaterThanOrEqual(43); });
  it('hashes tokens deterministically without storing plaintext', () => { const t = newOpaqueToken(); expect(hashToken(t)).toBe(hashToken(t)); expect(hashToken(t)).not.toContain(t); });
  it('compares safely', () => { expect(constantTimeEqual('abc', 'abc')).toBe(true); expect(constantTimeEqual('abc', 'abd')).toBe(false); expect(constantTimeEqual('abc', 'ab')).toBe(false); });
  it('computes idle and absolute expiry', () => { const now = new Date('2026-11-01T00:00:00Z'); const e = sessionExpiry(now, { idleMinutes: 15, absoluteHours: 8 }); expect(e.idleExpiresAt.toISOString()).toBe('2026-11-01T00:15:00.000Z'); expect(e.expiresAt.toISOString()).toBe('2026-11-01T08:00:00.000Z'); });
  it('rejects revoked/expired sessions', () => { const now = new Date(); expect(sessionValid(now, new Date(now.getTime() + 1000), new Date(now.getTime() + 2000))).toBe(true); expect(sessionValid(now, new Date(now.getTime() - 1), new Date(now.getTime() + 2000))).toBe(false); expect(sessionValid(now, new Date(now.getTime() + 1000), new Date(now.getTime() + 2000), now)).toBe(false); });
  it('uses secure cookie in production only', () => { expect(cookieOptions(true).secure).toBe(true); expect(cookieOptions(false).secure).toBe(false); expect(cookieOptions(true).httpOnly).toBe(true); });
});
describe('PKCE and redirects', () => {
  it('verifies S256 challenge', () => { const p = pkcePair(); expect(verifyPkce(p.verifier, p.challenge)).toBe(true); expect(verifyPkce('wrong', p.challenge)).toBe(false); });
  it('requires exact redirect allowlist', () => { expect(() => assertRedirectAllowed('https://app.example/cb', ['https://app.example/cb'])).not.toThrow(); expect(() => assertRedirectAllowed('https://evil.example/cb', ['https://app.example/cb'])).toThrow('REDIRECT_NOT_ALLOWED'); });
});

describe('cookie naming', () => {
  it('uses host prefix in production', () => expect(sessionCookieName(true)).toBe('__Host-gs_session'));
  it('rejects non-host production cookie', () => expect(() => sessionCookieName(true, 'gs')).toThrow('HOST_COOKIE_REQUIRED'));
  it('uses dev cookie on local http', () => expect(sessionCookieName(false, '__Host-gs_session')).toBe('gs_session_dev'));
});
