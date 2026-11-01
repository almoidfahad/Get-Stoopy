import { NextResponse } from 'next/server';
import { completeLogin } from '@getstoopy/bff';
import { webConfig } from '@/lib/config';
import { readTransactionCookie, clearTransactionCookie, apiFetch } from '@/lib/bff';
export async function GET(req: Request) {
  const cfg = webConfig();
  const tx = await readTransactionCookie() as any;
  const fail = NextResponse.redirect(`${cfg.webOrigin}/account?link=failed`);
  clearTransactionCookie(fail);
  if (!tx || tx.purpose !== 'link') return fail;
  try {
    const url = new URL(`${cfg.webOrigin}/api/auth/link/callback`);
    url.search = new URL(req.url).search;
    const tokens = await completeLogin({ issuer: cfg.issuer, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: url.origin + url.pathname, allowInsecureHttp: cfg.allowInsecureHttp }, url, tx);
    if (!tokens.id_token) throw new Error('ID_TOKEN_MISSING');
    const me = await apiFetch('/auth/me');
    if (!me.ok) throw new Error('SESSION_REQUIRED');
    const { csrfToken } = await me.json() as { csrfToken: string };
    const link = await apiFetch('/auth/identities/link', { method: 'POST', headers: { 'content-type': 'application/json', 'origin': cfg.webOrigin, 'x-csrf-token': csrfToken }, body: JSON.stringify({ idToken: tokens.id_token }) });
    if (!link.ok) throw new Error('LINK_FAILED');
    const ok = NextResponse.redirect(`${cfg.webOrigin}/account?link=success`);
    clearTransactionCookie(ok);
    return ok;
  } catch { return fail; }
}
