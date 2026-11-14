import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from 'jose';
import { createSyntheticSupabaseSession, SYNTHETIC_SUPABASE_ISSUER } from '../../../tests/integration/supabase-session-fixture';

const sub = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
let privateKey: CryptoKey, publicKeys: JSONWebKeySet;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true }); privateKey = pair.privateKey;
  publicKeys = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'synthetic', alg: 'RS256', use: 'sig' }] };
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
async function sign(changes: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: SYNTHETIC_SUPABASE_ISSUER, aud: 'authenticated', sub, session_id: sessionId, role: 'authenticated', is_anonymous: false, iat: now, exp: now + 120, ...changes }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic' }).sign(privateKey);
}
function setup() {
  const user = { userId: '33333333-3333-4333-8333-333333333333', status: 'ACTIVE', authorizationVersion: 7 };
  const tx = { $executeRaw: vi.fn().mockResolvedValue(0), $queryRaw: vi.fn().mockResolvedValue([user]), session: { create: vi.fn().mockResolvedValue({}) } };
  const database = { $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(tx)) };
  const options = { environment: 'test', database: database as any, publicKeys, idleMinutes: 15, absoluteHours: 8 };
  return { user, tx, database, options };
}

describe('unwired synthetic Supabase to opaque-session fixture', () => {
  it.each(['development', 'staging', 'production'])('rejects actual runtime %s before checking tokens or DB', async environment => {
    vi.stubEnv('NODE_ENV', environment); const { options, database } = setup();
    await expect(createSyntheticSupabaseSession({ ...options, accessToken: 'not-a-token' })).rejects.toThrow('SUPABASE_FIXTURE_DISABLED');
    expect(database.$transaction).not.toHaveBeenCalled();
  });
  it('also requires explicit test environment, bounded policy and public asymmetric keys', async () => {
    vi.stubEnv('NODE_ENV', 'test'); const { options, database } = setup();
    await expect(createSyntheticSupabaseSession({ ...options, environment: 'production', accessToken: '' })).rejects.toThrow('SUPABASE_FIXTURE_DISABLED');
    for (const idleMinutes of [0, -1, NaN, 1.5, 1441]) await expect(createSyntheticSupabaseSession({ ...options, idleMinutes, accessToken: '' })).rejects.toThrow('SUPABASE_FIXTURE_POLICY_INVALID');
    for (const absoluteHours of [0, -1, NaN, 1.5, 169]) await expect(createSyntheticSupabaseSession({ ...options, absoluteHours, accessToken: '' })).rejects.toThrow('SUPABASE_FIXTURE_POLICY_INVALID');
    for (const keys of [[], [{ kty: 'oct', k: 'secret' }], [{ ...publicKeys.keys[0], d: 'private' }], Array(11).fill(publicKeys.keys[0])]) {
      await expect(createSyntheticSupabaseSession({ ...options, publicKeys: { keys } as any, accessToken: '' })).rejects.toThrow('SUPABASE_FIXTURE_KEYS_INVALID');
    }
    expect(database.$transaction).not.toHaveBeenCalled();
  });
  it('rejects tokens from another project and bad signatures before database access', async () => {
    vi.stubEnv('NODE_ENV', 'test'); const { options, database } = setup();
    await expect(createSyntheticSupabaseSession({ ...options, accessToken: await sign({ iss: 'https://actual-project.example/auth/v1' }) })).rejects.toThrow('SUPABASE_DRAFT_TOKEN_INVALID');
    await expect(createSyntheticSupabaseSession({ ...options, accessToken: 'private-invalid-token' })).rejects.toThrow('SUPABASE_DRAFT_TOKEN_INVALID');
    const now = Math.floor(Date.now() / 1000);
    await expect(createSyntheticSupabaseSession({ ...options, accessToken: await sign({ iat: now - 20, exp: now - 1 }) })).rejects.toThrow('SUPABASE_DRAFT_TOKEN_INVALID');
    const wrongPair = await generateKeyPair('RS256', { extractable: true });
    const wrongKeys = { keys: [{ ...(await exportJWK(wrongPair.publicKey)), kid: 'synthetic', alg: 'RS256', use: 'sig' }] };
    await expect(createSyntheticSupabaseSession({ ...options, publicKeys: wrongKeys, accessToken: await sign() })).rejects.toThrow('SUPABASE_DRAFT_TOKEN_INVALID');
    expect(database.$transaction).not.toHaveBeenCalled();
  });
  it('requires a pre-linked active local account and does not create a new one', async () => {
    vi.stubEnv('NODE_ENV', 'test'); const { options, tx } = setup();
    const token = await sign({ email: 'private@example.invalid' });
    for (const rows of [[], [{ userId: 'other', status: 'SUSPENDED', authorizationVersion: 2 }]]) {
      tx.$queryRaw.mockResolvedValueOnce(rows);
      await expect(createSyntheticSupabaseSession({ ...options, accessToken: token })).rejects.toThrow('SUPABASE_FIXTURE_IDENTITY_UNAVAILABLE');
    }
    expect(tx.session.create).not.toHaveBeenCalled();
  });
  it('creates a hashed opaque session bound to the local user and provider expiry, not token metadata', async () => {
    vi.stubEnv('NODE_ENV', 'test'); const { options, tx, user } = setup();
    const accessToken = await sign({ app_metadata: { role: 'super_admin' }, email: 'private@example.invalid' });
    const result = await createSyntheticSupabaseSession({ ...options, accessToken });
    expect(tx.session.create).toHaveBeenCalledOnce();
    const data = tx.session.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ userId: user.userId, authVersion: 7, state: 'ACTIVE', assuranceLevel: 'PASSWORD', encryptedTokenEnvelope: null });
    expect(data.tokenHash).toBe(createHash('sha256').update(result.sessionToken).digest('hex'));
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 120_000);
    expect(data.idleExpiresAt.getTime()).toBeLessThanOrEqual(data.expiresAt.getTime());
    expect(result.sessionToken).not.toBe(accessToken);
    expect(JSON.stringify(data)).not.toContain('private@example.invalid');
    expect(JSON.stringify(data)).not.toContain(accessToken);
  });
  it('rechecks token expiry after waiting for the identity lock', async () => {
    vi.stubEnv('NODE_ENV', 'test'); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const { options, tx } = setup(); const token = await sign({ exp: Math.floor(Date.now() / 1000) + 2 });
    tx.$queryRaw.mockImplementationOnce(async () => { vi.advanceTimersByTime(3000); return [{ userId: 'user', status: 'ACTIVE', authorizationVersion: 1 }]; });
    await expect(createSyntheticSupabaseSession({ ...options, accessToken: token })).rejects.toThrow('SUPABASE_FIXTURE_TOKEN_EXPIRED');
    expect(tx.session.create).not.toHaveBeenCalled();
  });
});
