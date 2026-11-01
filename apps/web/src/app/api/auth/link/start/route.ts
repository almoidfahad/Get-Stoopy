import { NextResponse } from 'next/server';
import { beginLogin } from '@getstoopy/bff';
import { webConfig } from '@/lib/config';
import { setTransactionCookie, apiFetch } from '@/lib/bff';
export async function GET() {
  const cfg = webConfig();
  const me = await apiFetch('/auth/me');
  if (!me.ok) return NextResponse.redirect(`${cfg.webOrigin}/login`);
  const { url, transaction } = await beginLogin({ issuer: cfg.issuer, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: `${cfg.webOrigin}/api/auth/link/callback`, allowInsecureHttp: cfg.allowInsecureHttp });
  const res = NextResponse.redirect(url);
  await setTransactionCookie(res, { ...transaction, purpose: 'link' } as any);
  return res;
}
