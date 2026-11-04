import { NextResponse } from 'next/server';
import { parseCartMutation } from '@getstoopy/core';
import { webConfig } from '@/lib/config';
import { mutateCart } from '@/lib/cart';

/**
 * Cart mutations for the storefront.
 *
 * POST adds, PATCH changes a quantity, DELETE removes a line. Every method is
 * same-origin checked here and CSRF/origin checked again by the API, so this route
 * adds no authority of its own — it only translates and validates.
 */

async function handle(op: 'add' | 'update' | 'remove', req: Request): Promise<Response> {
  // A misconfigured deployment must not be reported as an origin attack: the two
  // need different responses from an operator, so they get different codes.
  let allowedOrigin: string;
  try {
    allowedOrigin = webConfig().webOrigin;
  } catch {
    return NextResponse.json({ code: 'CONFIG_INVALID' }, { status: 503 });
  }
  if (req.headers.get('origin') !== allowedOrigin) {
    return NextResponse.json({ code: 'ORIGIN_DENIED' }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ code: 'BODY_INVALID' }, { status: 400 });
  }

  const parsed = parseCartMutation(op, raw);
  if (!parsed.ok) return NextResponse.json({ code: parsed.code }, { status: 400 });

  const result = await mutateCart(op, parsed.value);
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: Request): Promise<Response> {
  return handle('add', req);
}
export async function PATCH(req: Request): Promise<Response> {
  return handle('update', req);
}
export async function DELETE(req: Request): Promise<Response> {
  return handle('remove', req);
}