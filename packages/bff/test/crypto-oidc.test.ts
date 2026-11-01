import { describe, it, expect } from 'vitest';
import { encryptJson, decryptJson, csrfTokenForSession } from '../src/crypto';
import { beginLogin, completeLogin, discover } from '../src/oidc';
const key = 'a'.repeat(64);
describe('BFF crypto', () => {
  it('encrypts and decrypts JSON envelopes', () => {
    const env = encryptJson({ state: 's', nonce: 'n' }, key);
    expect(env).not.toContain('"state":"s"');
    expect(decryptJson(env, key)).toEqual({ state: 's', nonce: 'n' });
  });
  it('rejects tampered envelopes', () => {
    const env = encryptJson({ a: 1 }, key);
    const parsed = JSON.parse(env); const tag = Buffer.from(parsed.tag, 'base64url'); tag[0] ^= 0xff; parsed.tag = tag.toString('base64url');
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

  it('rejects insecure HTTP OIDC outside localhost development', async () => {
    await expect(discover({ issuer: 'http://example.com/realms/get-stoopy', clientId: 'x', clientSecret: 'y', redirectUri: 'http://localhost:3000/api/auth/callback', allowInsecureHttp: true })).rejects.toThrow('INSECURE_OIDC_ONLY_LOCALHOST_DEV');
  });
