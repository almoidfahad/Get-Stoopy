import { createHash, randomBytes } from 'node:crypto';
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
export function verifyPkce(verifier: string, challenge: string): boolean {
  const actual = createHash('sha256').update(verifier).digest('base64url');
  return actual === challenge;
}
export function newState(): string { return randomBytes(24).toString('base64url'); }
export function assertRedirectAllowed(uri: string, allowlist: string[]): void {
  if (!allowlist.includes(uri)) throw new Error('REDIRECT_NOT_ALLOWED');
}
