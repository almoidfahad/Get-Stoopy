import { jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';

/** Verify the signed ID token before it can identify an account or create a session. */
export async function verifyIdToken(token: string, keys: JWTVerifyGetKey, issuer: string, audience: string): Promise<JWTPayload & { sub: string }> {
  const { payload } = await jwtVerify(token, keys, {
    issuer,
    audience,
    requiredClaims: ['sub', 'iat', 'exp'],
  });
  // Do not coerce missing/non-string subjects: e.g. String(undefined) is a
  // truthy value and could otherwise become a persistent identity key.
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 255 ||
      typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) ||
      typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new Error('ID_TOKEN_CLAIMS_INVALID');
  }
  return payload as JWTPayload & { sub: string };
}
