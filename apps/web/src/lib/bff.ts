import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { decryptJson, encryptJson, type LoginTransaction } from '@getstoopy/bff';
import { webConfig } from './config';
const TX_COOKIE = 'gs_oidc_tx';
export type OidcTransaction = LoginTransaction & { purpose?: 'link'; sessionHash?: string };
export async function setTransactionCookie(res: NextResponse, tx: OidcTransaction) {
  const cfg = webConfig();
  res.cookies.set(TX_COOKIE, encryptJson(tx, cfg.encryptionKey), { httpOnly: true, secure: cfg.production, sameSite: 'lax', path: '/api/auth', maxAge: 600 });
}
export async function readTransactionCookie(): Promise<OidcTransaction | null> {
  const cfg = webConfig();
  const raw = (await cookies()).get(TX_COOKIE)?.value;
  if (!raw) return null;
  try { return decryptJson<OidcTransaction>(raw, cfg.encryptionKey); } catch { return null; }
}
export function clearTransactionCookie(res: NextResponse) { res.cookies.set(TX_COOKIE, '', { httpOnly: true, path: '/api/auth', maxAge: 0 }); }
export function setSessionCookie(res: NextResponse, token: string, expiresAt: string) {
  const cfg = webConfig();
  res.cookies.set(cfg.sessionCookieName, token, { httpOnly: true, secure: cfg.production, sameSite: 'lax', path: '/', expires: new Date(expiresAt) });
}
export function clearSessionCookie(res: NextResponse) {
  const cfg = webConfig();
  res.cookies.set(cfg.sessionCookieName, '', { httpOnly: true, secure: cfg.production, sameSite: 'lax', path: '/', maxAge: 0 });
}
export async function readSessionCookie(): Promise<string | undefined> {
  const cfg = webConfig();
  return (await cookies()).get(cfg.sessionCookieName)?.value;
}
export async function apiFetch(path: string, init: RequestInit = {}) {
  const cfg = webConfig();
  const session = await readSessionCookie();
  const headers = new Headers(init.headers);
  if (session) headers.set('cookie', `${cfg.sessionCookieName}=${session}`);
  return fetch(`${cfg.apiUrl}/api/v1${path}`, { ...init, headers, cache: 'no-store' });
}
export function assertSameOrigin(req: Request) {
  const cfg = webConfig();
  const origin = req.headers.get('origin');
  if (!origin || origin !== cfg.webOrigin) throw new Error('ORIGIN_DENIED');
}
