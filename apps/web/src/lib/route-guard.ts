import { NextResponse } from 'next/server';
import { webConfig } from './config';

/**
 * Shared guards for the storefront's own mutation routes.
 *
 * A misconfigured deployment and a cross-origin request need different responses
 * from an operator, so they get different codes: 503 CONFIG_INVALID versus 403
 * ORIGIN_DENIED. These routes add no authority of their own — the API re-checks
 * the session, the origin and the CSRF token.
 */
export function checkOrigin(req: Request): NextResponse | null {
  let allowedOrigin: string;
  try {
    allowedOrigin = webConfig().webOrigin;
  } catch {
    return NextResponse.json({ code: 'CONFIG_INVALID' }, { status: 503 });
  }
  if (req.headers.get('origin') !== allowedOrigin) {
    return NextResponse.json({ code: 'ORIGIN_DENIED' }, { status: 403 });
  }
  return null;
}

export async function readJsonBody(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, value: await req.json() };
  } catch {
    return { ok: false, response: NextResponse.json({ code: 'BODY_INVALID' }, { status: 400 }) };
  }
}
