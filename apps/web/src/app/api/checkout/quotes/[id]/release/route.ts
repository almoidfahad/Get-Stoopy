import { NextResponse } from 'next/server';
import { parseQuoteRelease } from '@getstoopy/core';
import { releaseQuote } from '@/lib/checkout';
import { checkOrigin, readJsonBody } from '@/lib/route-guard';

/**
 * Release a quote's stock reservations.
 *
 * The audit reason is fixed in `parseQuoteRelease` rather than accepted from the
 * browser, because it is written to the audit log and the inventory history.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = checkOrigin(req);
  if (denied) return denied;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  const parsed = parseQuoteRelease(body.value);
  if (!parsed.ok) return NextResponse.json({ code: parsed.code }, { status: 400 });

  const { id } = await ctx.params;
  const result = await releaseQuote(id, parsed.value);
  return NextResponse.json(result.body, { status: result.status });
}
