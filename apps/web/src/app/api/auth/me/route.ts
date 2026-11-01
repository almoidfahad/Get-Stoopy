import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/bff';
export async function GET() {
  const res = await apiFetch('/auth/me');
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
