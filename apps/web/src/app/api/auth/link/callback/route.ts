import { NextResponse } from 'next/server';
import { constantTimeEqual, hashToken } from '@getstoopy/auth';
import { completeLogin, csrfTokenForSession } from '@getstoopy/bff';
import { webConfig } from '@/lib/config';
import { readTransactionCookie, clearTransactionCookie, readSessionCookie, apiFetch } from '@/lib/bff';

function result(outcome: 'failed' | 'unconfirmed' | 'success') {
  const res = new NextResponse(null, { status: 303, headers: { Location: `/account?link=${outcome}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  clearTransactionCookie(res);
  return res;
}

export async function GET(req: Request) {
  let linkRequested = false;
  try {
    const cfg = webConfig();
    const tx = await readTransactionCookie();
    const session = await readSessionCookie();
    const redirectUri = `${cfg.webOrigin}/api/auth/link/callback`;
    if (!tx || tx.purpose !== 'link' || tx.redirectUri !== redirectUri ||
        typeof tx.sessionHash !== 'string' || !/^[a-f0-9]{64}$/.test(tx.sessionHash) ||
        !session || !/^[A-Za-z0-9_-]{43}$/.test(session) || !constantTimeEqual(tx.sessionHash, hashToken(session))) return result('failed');
    const url = new URL(redirectUri);
    url.search = new URL(req.url).search;
    const tokens = await completeLogin({ issuer: cfg.issuer, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri, allowInsecureHttp: cfg.allowInsecureHttp }, url, tx);
    if (typeof tokens.id_token !== 'string' || !tokens.id_token) throw new Error('ID_TOKEN_MISSING');
    // Derive CSRF from the session bound at start; the backend still validates
    // the session, token and authorization. Never follow a redirect with tokens.
    linkRequested = true;
    const link = await apiFetch('/auth/identities/link', { method: 'POST', headers: { 'content-type': 'application/json', origin: cfg.webOrigin, 'x-csrf-token': csrfTokenForSession(session) }, body: JSON.stringify({ idToken: tokens.id_token }), redirect: 'manual', signal: AbortSignal.timeout(8_000) });
    if (link.status !== 201) return result('unconfirmed');
    const body: unknown = await link.json();
    if (!body || typeof body !== 'object' || (body as Record<string, unknown>).linked !== true || (body as Record<string, unknown>).issuer !== cfg.issuer) return result('unconfirmed');
    return result('success');
  } catch {
    // Once sent, a timeout or unreadable response does not prove the mutation
    // failed. Never automatically repeat an uncertain link request.
    return result(linkRequested ? 'unconfirmed' : 'failed');
  }
}
