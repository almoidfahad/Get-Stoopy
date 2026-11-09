import 'reflect-metadata';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CompactSign, createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { SessionService } from '../../../apps/api/src/auth/session.service.js';

const issuer = 'https://identity.example.test/realm';
const audience = 'get-stoopy-web';
let signingKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;
const now = Math.floor(Date.now() / 1000);
const valid = { iss: issuer, aud: audience, sub: 'provider-subject', iat: now, exp: now + 600 };

beforeAll(async () => {
  const first = await generateKeyPair('RS256', { extractable: true });
  signingKey = first.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(first.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }] });
});
async function sign(payload: JWTPayload, key = signingKey) {
  return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(key);
}
function makeService() {
  const user = { id: 'user-1', status: 'ACTIVE', displayName: 'Fixture', authorizationVersion: 1 };
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    userIdentity: { findUnique: vi.fn().mockResolvedValue({ id: 'identity-1', user }), update: vi.fn().mockResolvedValue({}) },
    session: { create: vi.fn().mockResolvedValue({}) },
  };
  const privileged = { $transaction: vi.fn(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx)) };
  const env = { KEYCLOAK_ISSUER: issuer, KEYCLOAK_CLIENT_ID: audience, SESSION_IDLE_MINUTES: 15, PRIVILEGED_ABSOLUTE_HOURS: 8, SESSION_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64) };
  const service = new SessionService({} as any, privileged as any, env as any);
  (service as any).jwks = jwks;
  return { service, privileged, tx };
}

describe('signed identity token session creation', () => {
  it('accepts a valid signed ID token and preserves the opaque subject', async () => {
    const { service, tx, privileged } = makeService();
    const result = await service.createFromIdToken({ idToken: await sign({ ...valid, sub: ' provider-subject ' }) });
    expect(tx.userIdentity.findUnique.mock.calls[0]?.[0]).toEqual({ where: { issuer_subject: { issuer, subject: ' provider-subject ' } }, include: { user: true } });
    expect(tx.session.create).toHaveBeenCalledOnce();
    expect(privileged.$transaction).toHaveBeenCalledTimes(2);
    expect(result.user.id).toBe('user-1');
    expect(result.sessionToken).toBeTruthy();
  });
  const missing = (claim: keyof typeof valid) => { const copy: Record<string, unknown> = { ...valid }; delete copy[claim]; return copy as JWTPayload; };
  it.each([
    ['missing subject', missing('sub')], ['missing expiration', missing('exp')], ['missing issued-at', missing('iat')],
    ['empty subject', { ...valid, sub: '' }], ['blank subject', { ...valid, sub: '  ' }],
    ['numeric subject', { ...valid, sub: 42 }], ['null subject', { ...valid, sub: null }],
    ['subject too long', { ...valid, sub: 'x'.repeat(256) }],
    ['expired token', { ...valid, exp: now - 10 }], ['wrong issuer', { ...valid, iss: 'https://other.test' }],
    ['wrong audience', { ...valid, aud: 'other-client' }], ['invalid expiration', { ...valid, exp: 'later' }],
    ['invalid issued-at', { ...valid, iat: 'yesterday' }],
  ])('rejects %s before any database transaction', async (_label, claims) => {
    const { service, privileged } = makeService();
    await expect(service.createFromIdToken({ idToken: await sign(claims as JWTPayload) })).rejects.toMatchObject({ status: 401, response: { code: 'OIDC_VERIFICATION_FAILED' } });
    expect(privileged.$transaction).not.toHaveBeenCalled();
  });
  it.each(['iat', 'exp'])('rejects a non-finite %s parsed from a signed JSON number', async claim => {
    const { service, privileged } = makeService();
    // JSON.parse accepts 1e400 as Infinity; the token is genuinely signed.
    const json = JSON.stringify(valid).replace(`"${claim}":${valid[claim as 'iat' | 'exp']}`, `"${claim}":1e400`);
    const token = await new CompactSign(new TextEncoder().encode(json)).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(signingKey);
    await expect(service.createFromIdToken({ idToken: token })).rejects.toMatchObject({ status: 401 });
    expect(privileged.$transaction).not.toHaveBeenCalled();
  });
  it('rejects a token signed by an untrusted key before database access', async () => {
    const { service, privileged } = makeService();
    await expect(service.createFromIdToken({ idToken: await sign(valid, otherKey) })).rejects.toMatchObject({ status: 401 });
    expect(privileged.$transaction).not.toHaveBeenCalled();
  });
});
