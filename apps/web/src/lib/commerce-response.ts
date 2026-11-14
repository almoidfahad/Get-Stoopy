// Only structured API client errors are forwarded. A timeout, redirect,
// unreadable body, unexpected success or server error cannot establish whether
// an upstream mutation completed; represent those as an uncertain 502.
export async function commerceFailure(res: Response, unknownCode: string): Promise<{ status: number; body: { code: string } }> {
  const unknown = { status: 502, body: { code: unknownCode } };
  if (res.status === 401) return { status: 401, body: { code: 'SIGN_IN_REQUIRED' } };
  if (res.status < 400 || res.status >= 500 || res.status === 408) return unknown;
  try {
    const body: unknown = await res.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return unknown;
    const code = (body as Record<string, unknown>).code;
    if (typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(code)) return unknown;
    return { status: res.status, body: { code } };
  } catch {
    return unknown;
  }
}
