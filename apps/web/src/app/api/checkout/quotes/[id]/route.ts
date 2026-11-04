import { NextResponse } from 'next/server';
import { readQuote } from '@/lib/checkout';

/**
 * Read a quote the signed-in buyer owns. Used to recover a quote after a page
 * reload, so reserved stock is never stranded without a way to release it.
 * Ownership is enforced by the API, not here.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const result = await readQuote(id);
  return NextResponse.json(result.body, { status: result.status });
}
