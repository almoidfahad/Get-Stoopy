import { NextResponse } from 'next/server';
import { completeLogin } from '@getstoopy/bff';
import { webConfig } from '@/lib/config';
import { readTransactionCookie, clearTransactionCookie, setSessionCookie } from '@/lib/bff';

// Never reflect the callback query or an untrusted request host into a redirect.
// Clear the transient OIDC transaction even when configuration is unavailable.
function failed(error: 'unavailable' | 'oidc' | 'session') {
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: `/login?error=${error}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
  clearTransactionCookie(res);
  return res;
}

// The API creates a 32-byte base64url token and returns ISO UTC expiry text.
// Shape checks do not authenticate a token; the API validates it on use.
function isSessionResult(value: unknown): value is { sessionToken: string; expiresAt: string } {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  if (typeof result.sessionToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.sessionToken) ||
      typeof result.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(result.expiresAt)) return false;
  const timestamp = Date.parse(result.expiresAt);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) return false;
  const canonical = result.expiresAt.includes('.') ? result.expiresAt : result.expiresAt.replace(/Z$/, '.000Z');
  return new Date(timestamp).toISOString() === canonical;
}

export async function GET(req: Request) {
  let cfg: ReturnType<typeof webConfig>;
  try { cfg = webConfig(); } catch { return failed('unavailable'); }
  let sessionRequested = false;
  try {
    const tx = await readTransactionCookie();
    if (!tx) return failed('oidc');
    const url = new URL(cfg.redirectUri);
    url.search = new URL(req.url).search;
    const tokens = await completeLogin({ issuer: cfg.issuer, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri, allowInsecureHttp: cfg.allowInsecureHttp }, url, tx);
    if (!tokens.id_token) throw new Error('ID_TOKEN_MISSING');
    const body = { idToken: tokens.id_token, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, providerExpiresAt: tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString() : undefined };
    sessionRequested = true;
    const apiRes = await fetch(`${cfg.apiUrl}/api/v1/auth/session`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bff-secret': cfg.bffSecret },
      body: JSON.stringify(body), cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(8_000),
    });
    if (apiRes.status !== 201) throw new Error('SESSION_CREATE_FAILED');
    const session: unknown = await apiRes.json();
    if (!isSessionResult(session)) throw new Error('SESSION_RESPONSE_INVALID');
    const res = NextResponse.redirect(`${cfg.webOrigin}/account`);
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('Referrer-Policy', 'no-referrer');
    clearTransactionCookie(res);
    setSessionCookie(res, session.sessionToken, session.expiresAt);
    return res;
  } catch {
    // Once the session request starts, even a failed or unreadable response may
    // have followed a committed server-side session creation.
    return failed(sessionRequested ? 'session' : 'oidc');
  }
}
