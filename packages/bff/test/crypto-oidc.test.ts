import { describe, it, expect } from 'vitest';
import { encryptJson, decryptJson, csrfTokenForSession } from '../src/crypto';
import { beginLogin, completeLogin } from '../src/oidc';
const key = 'a'.repeat(64);
describe('BFF crypto', () => {
  it('encrypts and decrypts JSON envelopes', () => {
    const env = encryptJson({ state: 's', nonce: 'n' }, key);
    expect(env).not.toContain('"state":"s"');
    expect(decryptJson(env, key)).toEqual({ state: 's', nonce: 'n' });
  });
  it('rejects tampered envelopes', () => {
    const env = encryptJson({ a: 1 }, key);
    const parsed = JSON.parse(env); parsed.data = 'x' + parsed.data.slice(1);
    expect(() => decryptJson(JSON.stringify(parsed), key)).toThrow();
  });
  it('derives stable CSRF tokens per session', () => {
    expect(csrfTokenForSession('token')).toBe(csrfTokenForSession('token'));
    expect(csrfTokenForSession('token')).not.toBe(csrfTokenForSession('other'));
  });
});
describe('OIDC transaction guards', () => {
  const cfg = { issuer: 'http://localhost:8080/realms/get-stoopy', clientId: 'get-stoopy-web', clientSecret: 'secret', redirectUri: 'http://localhost:3000/api/auth/callback' };
  it('rejects expired transactions before network', async () => {
    await expect(completeLogin(cfg, new URL(cfg.redirectUri + '?state=x&code=y'), { state: 'x', nonce: 'n', verifier: 'v', redirectUri: cfg.redirectUri, createdAt: Date.now() - 11 * 60_000 })).rejects.toThrow('OIDC_TRANSACTION_EXPIRED');
  });
  it('rejects state mismatch before network', async () => {
    await expect(completeLogin(cfg, new URL(cfg.redirectUri + '?state=bad&code=y'), { state: 'good', nonce: 'n', verifier: 'v', redirectUri: cfg.redirectUri, createdAt: Date.now() })).rejects.toThrow('OIDC_STATE_MISMATCH');
  });
});
