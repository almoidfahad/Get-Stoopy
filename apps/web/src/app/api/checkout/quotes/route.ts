import { NextResponse } from 'next/server';
import { parseQuoteCreate } from '@getstoopy/core';
import { createQuote } from '@/lib/checkout';
import { checkOrigin, readJsonBody } from '@/lib/route-guard';

/**
 * Reserve stock and produce a checkout quote.
 *
 * This is not an order endpoint. No payment is attempted and no money moves; the
 * quote API itself reports payment as NOT_IMPLEMENTED.
 */
export async function POST(req: Request): Promise<Response> {
  const denied = checkOrigin(req);
  if (denied) return denied;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  const parsed = parseQuoteCreate(body.value);
  if (!parsed.ok) return NextResponse.json({ code: parsed.code }, { status: 400 });

  const result = await createQuote(parsed.value);
  return NextResponse.json(result.body, { status: result.status });
}
