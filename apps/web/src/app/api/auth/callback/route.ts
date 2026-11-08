import { NextResponse } from 'next/server';
import { completeLogin } from '@getstoopy/bff';
import { webConfig } from '@/lib/config';
import { readTransactionCookie, clearTransactionCookie, setSessionCookie } from '@/lib/bff';

// Never reflect the callback query or an untrusted request host into a redirect.
// Clear the transient OIDC transaction even when configuration is unavailable.
function failed(error: 'unavailable' | 'oidc') {
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: `/login?error=${error}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
  clearTransactionCookie(res);
  return res;
}

export async function GET(req: Request) {
  let cfg: ReturnType<typeof webConfig>;
  try { cfg = webConfig(); } catch { return failed('unavailable'); }
  try {
    const tx = await readTransactionCookie();
    if (!tx) return failed('oidc');
    const url = new URL(cfg.redirectUri);
    url.search = new URL(req.url).search;
    const tokens = await completeLogin({ issuer: cfg.issuer, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri, allowInsecureHttp: cfg.allowInsecureHttp }, url, tx);
    if (!tokens.id_token) throw new Error('ID_TOKEN_MISSING');
    const body = { idToken: tokens.id_token, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, providerExpiresAt: tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString() : undefined };
    const apiRes = await fetch(`${cfg.apiUrl}/api/v1/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bff-secret': cfg.bffSecret }, body: JSON.stringify(body), cache: 'no-store' });
    if (!apiRes.ok) throw new Error('SESSION_CREATE_FAILED');
    const session = await apiRes.json() as { sessionToken: string; expiresAt: string };
    const res = NextResponse.redirect(`${cfg.webOrigin}/account`);
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('Referrer-Policy', 'no-referrer');
    clearTransactionCookie(res);
    setSessionCookie(res, session.sessionToken, session.expiresAt);
    return res;
  } catch {
    return failed('oidc');
  }
}
