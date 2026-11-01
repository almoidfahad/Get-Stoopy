import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { csrfTokenForSession } from '@getstoopy/bff';
import { webConfig } from '@/lib/config';
import { clearSessionCookie, assertSameOrigin } from '@/lib/bff';
export async function POST(req: Request) {
  const cfg = webConfig();
  try { assertSameOrigin(req); } catch { return NextResponse.json({ code: 'ORIGIN_DENIED' }, { status: 403 }); }
  const token = (await cookies()).get(cfg.sessionCookieName)?.value;
  if (token) {
    await fetch(`${cfg.apiUrl}/api/v1/auth/logout`, { method: 'POST', headers: { cookie: `${cfg.sessionCookieName}=${token}`, origin: cfg.webOrigin, 'x-csrf-token': csrfTokenForSession(token) }, cache: 'no-store' }).catch(() => undefined);
  }
  const res = NextResponse.redirect(`${cfg.webOrigin}/`, { status: 303 });
  clearSessionCookie(res);
  return res;
}
