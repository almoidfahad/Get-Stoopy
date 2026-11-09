import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { csrfTokenForSession } from '@getstoopy/bff';
import { webConfig } from '@/lib/config';
import { clearSessionCookie, assertSameOrigin } from '@/lib/bff';
export async function POST(req: Request) {
  const cfg = webConfig();
  try { assertSameOrigin(req); } catch { return NextResponse.json({ code: 'ORIGIN_DENIED' }, { status: 403 }); }
  const token = (await cookies()).get(cfg.sessionCookieName)?.value;
  let unconfirmed = false;
  if (token) {
    try {
      const upstream = await fetch(`${cfg.apiUrl}/api/v1/auth/logout`, {
        method: 'POST', headers: { cookie: `${cfg.sessionCookieName}=${token}`, origin: cfg.webOrigin, 'x-csrf-token': csrfTokenForSession(token) },
        cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(8_000),
      });
      // The API's logout contract is 204 after revocation. A timeout, error,
      // redirect or unexpected success does not prove whether revocation occurred.
      unconfirmed = upstream.status !== 204;
    } catch { unconfirmed = true; }
  }
  const res = NextResponse.redirect(`${cfg.webOrigin}${unconfirmed ? '/sign-out-unconfirmed' : '/'}`, { status: 303 });
  res.headers.set('Cache-Control', 'no-store');
  // Clear this browser's cookie even if server-side revocation is uncertain.
  clearSessionCookie(res);
  return res;
}
