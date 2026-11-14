import { createLocalJWKSet, type JSONWebKeySet } from 'jose';
import { hashToken, newOpaqueToken, sessionExpiry } from '@getstoopy/auth';
import { csrfTokenForSession } from '@getstoopy/bff';
import { setRls, type PrivilegedPrismaService } from '../../apps/api/src/common/prisma.js';
import { verifyDraftSupabaseAccessToken } from '../../apps/api/src/auth/supabase-access-token-draft.js';

// This reserved example domain cannot be the hosted Supabase project. No API
// route or dependency injection provider exposes this disposable-test fixture.
export const SYNTHETIC_SUPABASE_ISSUER = 'https://supabase.example.test/auth/v1';

/**
 * Tests how a pre-existing synthetic identity might use the existing local
 * opaque session mechanism. Not a Supabase login: it does not check provider
 * revocation/status and MUST NOT be connected to real data or a live service.
 */
export async function createSyntheticSupabaseSession(input: {
  readonly environment: string;
  readonly accessToken: string;
  readonly publicKeys: JSONWebKeySet;
  readonly database: PrivilegedPrismaService;
  readonly idleMinutes: number;
  readonly absoluteHours: number;
}): Promise<{ readonly sessionToken: string; readonly csrfToken: string; readonly expiresAt: string; readonly idleExpiresAt: string }> {
  if (input.environment !== 'test' || process.env.NODE_ENV !== 'test') throw new Error('SUPABASE_FIXTURE_DISABLED');
  if (!Number.isSafeInteger(input.idleMinutes) || input.idleMinutes < 1 || input.idleMinutes > 1440 || !Number.isSafeInteger(input.absoluteHours) || input.absoluteHours < 1 || input.absoluteHours > 168) throw new Error('SUPABASE_FIXTURE_POLICY_INVALID');
  if (!input.publicKeys || !Array.isArray(input.publicKeys.keys) || !input.publicKeys.keys.length || input.publicKeys.keys.length > 10 || input.publicKeys.keys.some(k => !k || typeof k !== 'object' || !['RSA', 'EC'].includes(k.kty ?? '') || ['d', 'k', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some(field => field in k))) throw new Error('SUPABASE_FIXTURE_KEYS_INVALID');
  // Public key material is supplied directly; this fixture performs no network
  // discovery, and never trusts provider URLs from the token or a request.
  const keys = createLocalJWKSet(input.publicKeys);
  const identity = await verifyDraftSupabaseAccessToken(input.accessToken, keys, SYNTHETIC_SUPABASE_ISSUER);
  const token = newOpaqueToken();
  const result = await input.database.$transaction(async tx => {
    await setRls(tx, { userId: '00000000-0000-0000-0000-000000000000', authorizationVersion: 0, isSuper: true });
    // Lock existing identity and local account so supported concurrent updates
    // cannot race the active-status/version check while the session is created.
    const rows = await tx.$queryRaw<{ userId: string; status: string; authorizationVersion: number }[]>`
      SELECT u.id AS "userId", u.status, u."authorizationVersion"
      FROM "UserIdentity" i JOIN "User" u ON u.id=i."userId"
      WHERE i.issuer=${identity.issuer} AND i.subject=${identity.subject} AND i."providerKey"='supabase-fixture'
      FOR UPDATE OF i, u`;
    const user = rows[0];
    if (!user || user.status !== 'ACTIVE') throw new Error('SUPABASE_FIXTURE_IDENTITY_UNAVAILABLE');
    const now = new Date();
    const providerExpiry = identity.expiresAt * 1000;
    if (!Number.isSafeInteger(providerExpiry) || providerExpiry <= now.getTime()) throw new Error('SUPABASE_FIXTURE_TOKEN_EXPIRED');
    const policy = sessionExpiry(now, { idleMinutes: input.idleMinutes, absoluteHours: input.absoluteHours });
    const expiresAt = new Date(Math.min(policy.expiresAt.getTime(), providerExpiry));
    const idleExpiresAt = new Date(Math.min(policy.idleExpiresAt.getTime(), expiresAt.getTime()));
    await tx.session.create({ data: {
      userId: user.userId, tokenHash: hashToken(token), assuranceLevel: 'PASSWORD', state: 'ACTIVE',
      encryptedTokenEnvelope: null, expiresAt, idleExpiresAt, authVersion: user.authorizationVersion,
    } });
    return { expiresAt: expiresAt.toISOString(), idleExpiresAt: idleExpiresAt.toISOString() };
  });
  return { sessionToken: token, csrfToken: csrfTokenForSession(token), ...result };
}
