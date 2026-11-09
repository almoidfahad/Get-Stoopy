import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ webConfig: vi.fn(), cookies: vi.fn() }));
vi.mock('@/lib/config', () => ({ webConfig: mocks.webConfig }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
import { POST } from '../src/app/api/auth/logout/route';

const cfg = { webOrigin: 'https://shop.example.test', apiUrl: 'https://api.example.test', sessionCookieName: '__Host-gs_session', production: true };
const request = (origin: string | null = cfg.webOrigin) => new Request('https://untrusted.example.test/api/auth/logout', { method: 'POST', headers: origin ? { origin } : {} });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.webConfig.mockReturnValue(cfg);
  mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'sensitive-session' }) });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function expectCleared(res: Response) {
  const cookie = res.headers.get('set-cookie') ?? '';
  expect(cookie).toContain('__Host-gs_session=');
  expect(cookie).toMatch(/Max-Age=0/i);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Secure/i);
  expect(cookie).not.toContain('sensitive-session');
  expect(res.headers.get('cache-control')).toBe('no-store');
}

describe('logout revocation uncertainty', () => {
  it('redirects home and clears the local cookie after a confirmed 204', async () => {
    const res = await POST(request());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://shop.example.test/');
    expectCleared(res);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('https://api.example.test/api/v1/auth/logout');
    expect(init?.method).toBe('POST');
    expect(init?.cache).toBe('no-store');
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toMatchObject({ cookie: '__Host-gs_session=sensitive-session', origin: cfg.webOrigin, 'x-csrf-token': expect.any(String) });
  });
  it.each([200, 201, 302, 401, 403, 429, 500, 503])('clears the local cookie but warns when upstream returns %s', async status => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status }));
    const res = await POST(request());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://shop.example.test/sign-out-unconfirmed');
    expectCleared(res);
    expect(await res.text()).not.toContain('sensitive-session');
  });
  it('warns if the network fails, since revocation may have happened before the response was lost', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('private backend detail'));
    const res = await POST(request());
    expect(res.headers.get('location')).toBe('https://shop.example.test/sign-out-unconfirmed');
    expectCleared(res);
    expect(await res.text()).not.toContain('private backend detail');
  });
  it('times out and still clears the local cookie if the API stalls', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort());
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException('aborted', 'AbortError');
    });
    const res = await POST(request());
    expect(res.headers.get('location')).toBe('https://shop.example.test/sign-out-unconfirmed');
    expectCleared(res);
  });
  it('clears the local cookie without contacting the API when no session is present', async () => {
    mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) });
    const res = await POST(request());
    expect(res.headers.get('location')).toBe('https://shop.example.test/');
    expectCleared(res);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['https://other.example.test', null])('rejects origin %s without clearing or revoking the session', async origin => {
    const res = await POST(request(origin));
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
