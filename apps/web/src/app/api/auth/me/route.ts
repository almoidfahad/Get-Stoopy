import { NextResponse } from 'next/server';
import { readSession } from '@/lib/session-read';

export async function GET() {
  const result = await readSession();
  const headers = { 'Cache-Control': 'no-store' };
  if (result.state === 'signed-out') return NextResponse.json({ code: 'SIGN_IN_REQUIRED' }, { status: 401, headers });
  if (result.state === 'unavailable') return NextResponse.json({ code: 'SESSION_UNAVAILABLE' }, { status: 502, headers });
  return NextResponse.json(result.data, { status: 200, headers });
}
