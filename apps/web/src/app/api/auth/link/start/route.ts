import { NextResponse } from 'next/server';
import { hashToken } from '@getstoopy/auth';
import { beginLogin } from '@getstoopy/bff';
import { webConfig } from '@/lib/config';
import { setTransactionCookie, apiFetch, readSessionCookie } from '@/lib/bff';

function recovery(location: string) {
  return new NextResponse(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

export async function GET() {
  try {
    const cfg = webConfig();
    const session = await readSessionCookie();
    if (!session) return recovery('/login');
    // Only a canonical opaque session token can be bound to the transaction.
    if (!/^[A-Za-z0-9_-]{43}$/.test(session)) return recovery('/account?link=unavailable');
    const me = await apiFetch('/auth/me', { redirect: 'manual', signal: AbortSignal.timeout(8_000) });
    if (me.status === 401) return recovery('/login');
    if (me.status !== 200) return recovery('/account?link=unavailable');
    const { url, transaction } = await beginLogin({ issuer: cfg.issuer, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: `${cfg.webOrigin}/api/auth/link/callback`, allowInsecureHttp: cfg.allowInsecureHttp });
    const res = NextResponse.redirect(url);
    res.headers.set('Cache-Control', 'no-store');
    // A link may only finish in the session that started it, even if the user
    // signs out or switches accounts in another tab during provider login.
    await setTransactionCookie(res, { ...transaction, purpose: 'link', sessionHash: hashToken(session) });
    return res;
  } catch {
    return recovery('/account?link=unavailable');
  }
}
