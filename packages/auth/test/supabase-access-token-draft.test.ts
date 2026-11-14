import { beforeAll, describe, expect, it } from 'vitest';
import { CompactSign, createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { verifyDraftSupabaseAccessToken } from '../../../apps/api/src/auth/supabase-access-token-draft';

const issuer = 'https://synthetic.supabase.example/auth/v1';
const sub = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const now = Math.floor(Date.now() / 1000);
const valid: JWTPayload = { iss: issuer, aud: 'authenticated', sub, session_id: session, role: 'authenticated', is_anonymous: false, iat: now, exp: now + 600 };
let rsa: CryptoKey, other: CryptoKey, ec: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const r = await generateKeyPair('RS256', { extractable: true }); rsa = r.privateKey;
  const e = await generateKeyPair('ES256', { extractable: true }); ec = e.privateKey;
  other = (await generateKeyPair('RS256')).privateKey;
  keys = createLocalJWKSet({ keys: [
    { ...(await exportJWK(r.publicKey)), kid: 'rsa', alg: 'RS256', use: 'sig' },
    { ...(await exportJWK(e.publicKey)), kid: 'ec', alg: 'ES256', use: 'sig' },
  ] });
});
async function sign(claims: JWTPayload, key = rsa, algorithm = 'RS256', kid = 'rsa') {
  return new SignJWT(claims).setProtectedHeader({ alg: algorithm, kid }).sign(key);
}
const bad = (token: string, override = issuer) => expect(verifyDraftSupabaseAccessToken(token, keys, override)).rejects.toThrow('SUPABASE_DRAFT_TOKEN_INVALID');

describe('unwired synthetic Supabase access token verification draft', () => {
  it('accepts trusted asymmetric synthetic signatures but returns only identity metadata', async () => {
    const claims = { ...valid, email: 'private@example.invalid', user_metadata: { role: 'admin' }, app_metadata: { role: 'super_admin' } };
    const expected = { kind: 'DRAFT_IDENTITY_ONLY', issuer, subject: sub, providerSessionId: session, expiresAt: now + 600 };
    expect(await verifyDraftSupabaseAccessToken(await sign(claims), keys, issuer)).toEqual(expected);
    expect(await verifyDraftSupabaseAccessToken(await sign(claims, ec, 'ES256', 'ec'), keys, issuer)).toEqual(expected);
  });
  it.each([
    ['wrong issuer', { ...valid, iss: 'https://other.example/auth/v1' }],
    ['wrong audience', { ...valid, aud: 'other' }],
    ['multiple audiences', { ...valid, aud: ['authenticated', 'other'] }],
    ['wrong role', { ...valid, role: 'service_role' }],
    ['anonymous role', { ...valid, role: 'anon' }],
    ['anonymous session', { ...valid, is_anonymous: true }],
    ['missing anonymous flag', { ...valid, is_anonymous: undefined }],
    ['missing subject', { ...valid, sub: undefined }],
    ['non-UUID subject', { ...valid, sub: 'not-a-uuid' }],
    ['missing session ID', { ...valid, session_id: undefined }],
    ['invalid session ID', { ...valid, session_id: 'private-input' }],
    ['missing issued-at', { ...valid, iat: undefined }],
    ['future issued-at', { ...valid, iat: now + 300 }],
    ['expired token', { ...valid, exp: now - 1 }],
    ['not yet valid', { ...valid, nbf: now + 300 }],
    ['expiration equals issued-at', { ...valid, exp: now }],
    ['missing expiration', { ...valid, exp: undefined }],
    ['non-integer issued-at', { ...valid, iat: now - 0.5 }],
    ['non-integer expiration', { ...valid, exp: now + 0.5 }],
  ])('rejects %s', async (_label, claims) => { await bad(await sign(claims as JWTPayload)); });
  it('rejects signature mismatch, untrusted key IDs and unsupported symmetric algorithms', async () => {
    await bad(await sign(valid, other));
    await bad(await sign(valid, rsa, 'RS256', 'unknown'));
    const mac = new TextEncoder().encode('synthetic-hmac-key-for-local-unit-tests');
    await bad(await new SignJWT(valid).setProtectedHeader({ alg: 'HS256', kid: 'rsa' }).sign(mac));
  });
  it('rejects non-finite numeric claims from genuinely signed JSON', async () => {
    for (const field of ['exp', 'iat']) {
      const json = JSON.stringify(valid).replace(new RegExp(`"${field}":\\d+`), `"${field}":1e400`);
      const token = await new CompactSign(new TextEncoder().encode(json)).setProtectedHeader({ alg: 'RS256', kid: 'rsa' }).sign(rsa);
      await bad(token);
    }
  });
  it('rejects invalid issuer configuration or oversized/malformed tokens with generic errors', async () => {
    const token = await sign(valid);
    for (const value of ['http://synthetic.supabase.example/auth/v1', 'https://user:pass@synthetic.supabase.example/auth/v1', 'https://synthetic.supabase.example/auth/v1?query=private', 'https://synthetic.supabase.example/auth/v1/', 'not-a-url']) await bad(token, value);
    await bad('invalid-secret-marker');
    await bad('x'.repeat(8193));
    try { await verifyDraftSupabaseAccessToken('invalid-secret-marker', keys, issuer); throw new Error('unexpected success'); }
    catch (e) { expect(String(e)).not.toContain('invalid-secret-marker'); }
  });
});
