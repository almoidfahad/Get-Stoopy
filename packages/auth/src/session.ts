import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export function newOpaqueToken(): string { return randomBytes(32).toString('base64url'); }
export function hashToken(token: string): string { return createHash('sha256').update(token, 'utf8').digest('hex'); }
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8'), bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
export interface SessionPolicy { idleMinutes: number; absoluteHours: number; }
export function sessionExpiry(now: Date, policy: SessionPolicy): { idleExpiresAt: Date; expiresAt: Date } {
  if (policy.idleMinutes <= 0 || policy.absoluteHours <= 0) throw new Error('INVALID_SESSION_POLICY');
  return { idleExpiresAt: new Date(now.getTime() + policy.idleMinutes * 60_000), expiresAt: new Date(now.getTime() + policy.absoluteHours * 3_600_000) };
}
export function sessionValid(now: Date, idleExpiresAt: Date, expiresAt: Date, revokedAt?: Date): boolean {
  return !revokedAt && now < idleExpiresAt && now < expiresAt;
}
export function cookieOptions(production: boolean) {
  return { httpOnly: true, secure: production, sameSite: 'lax' as const, path: '/', maxAge: undefined as number | undefined };
}

export function sessionCookieName(production: boolean, configured?: string): string {
  if (production) {
    if (configured && !configured.startsWith('__Host-')) throw new Error('HOST_COOKIE_REQUIRED');
    return configured ?? '__Host-gs_session';
  }
  return configured && !configured.startsWith('__Host-') ? configured : 'gs_session_dev';
}
