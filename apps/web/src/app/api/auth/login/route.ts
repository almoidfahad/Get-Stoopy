import { NextResponse } from 'next/server';
import { beginLogin } from '@getstoopy/bff';
import { webConfig } from '@/lib/config';
import { setTransactionCookie } from '@/lib/bff';
export async function GET() {
  const cfg = webConfig();
  const { url, transaction } = await beginLogin({ issuer: cfg.issuer, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri });
  const res = NextResponse.redirect(url);
  await setTransactionCookie(res, transaction);
  return res;
}
