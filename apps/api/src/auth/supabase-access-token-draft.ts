import { jwtVerify, type JWTVerifyGetKey } from 'jose';

/**
 * Unwired candidate for a Supabase access-token boundary, tested only with
 * synthetic tokens. It has no runtime environment gate; do not wire it into an
 * API or session flow until the complete design is reviewed and verified.
 * A verified JWT is not proof of a currently active provider session or local
 * account. This function creates no session and grants no marketplace roles.
 * The caller MUST obtain both issuer and keys from trusted configuration, not
 * from token headers or request parameters. Symmetric legacy keys are excluded.
 */
export async function verifyDraftSupabaseAccessToken(token: string, keys: JWTVerifyGetKey, issuer: string): Promise<{
  readonly kind: 'DRAFT_IDENTITY_ONLY';
  readonly issuer: string;
  readonly subject: string;
  readonly providerSessionId: string;
  readonly expiresAt: number;
}> {
  try {
    if (typeof token !== 'string' || token.length < 1 || token.length > 8192 || typeof issuer !== 'string') throw new Error('invalid');
    const url = new URL(issuer);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/auth/v1' || url.href !== issuer) throw new Error('invalid');
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience: 'authenticated',
      algorithms: ['RS256', 'ES256'],
      requiredClaims: ['iss', 'aud', 'sub', 'iat', 'exp', 'session_id', 'role', 'is_anonymous'],
    });
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (payload.aud !== 'authenticated' || payload.role !== 'authenticated' || payload.is_anonymous !== false ||
        typeof payload.sub !== 'string' || !uuid.test(payload.sub) ||
        typeof payload.session_id !== 'string' || !uuid.test(payload.session_id) ||
        typeof payload.iat !== 'number' || !Number.isSafeInteger(payload.iat) || payload.iat < 0 || payload.iat > Math.floor(Date.now() / 1000) ||
        typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) || payload.exp <= payload.iat) throw new Error('invalid');
    // Do not project untrusted user/app metadata into marketplace permissions.
    return { kind: 'DRAFT_IDENTITY_ONLY', issuer, subject: payload.sub, providerSessionId: payload.session_id, expiresAt: payload.exp };
  } catch {
    // Never reflect token contents, key lookup errors, or provider response data.
    throw new Error('SUPABASE_DRAFT_TOKEN_INVALID');
  }
}
