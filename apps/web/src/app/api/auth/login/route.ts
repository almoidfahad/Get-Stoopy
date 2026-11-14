import { NextResponse } from 'next/server';
import { beginLogin } from '@getstoopy/bff';
import { webConfig } from '@/lib/config';
import { setTransactionCookie } from '@/lib/bff';

export async function GET() {
  try {
    const cfg = webConfig();
    const { url, transaction } = await beginLogin({ issuer: cfg.issuer, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri, allowInsecureHttp: cfg.allowInsecureHttp });
    const res = NextResponse.redirect(url);
    await setTransactionCookie(res, transaction);
    return res;
  } catch {
    // A relative Location avoids trusting the request Host or requiring WEB_ORIGIN
    // when configuration itself is missing. Do not expose provider/config errors.
    return new Response(null, { status: 303, headers: { Location: '/login?error=unavailable', 'Cache-Control': 'no-store' } });
  }
}
