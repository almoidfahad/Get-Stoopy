import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ webConfig: vi.fn(), completeLogin: vi.fn(), readTransactionCookie: vi.fn(), clearTransactionCookie: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock('@/lib/config', () => ({ webConfig: mocks.webConfig }));
vi.mock('@/lib/bff', () => ({ readTransactionCookie: mocks.readTransactionCookie, clearTransactionCookie: mocks.clearTransactionCookie, setSessionCookie: mocks.setSessionCookie }));
vi.mock('@getstoopy/bff', () => ({ completeLogin: mocks.completeLogin }));
import { GET } from '../src/app/api/auth/callback/route';

const config = { issuer: 'https://identity.example.test', clientId: 'client', clientSecret: 'secret-value', redirectUri: 'https://shop.example.test/api/auth/callback', webOrigin: 'https://shop.example.test', apiUrl: 'https://api.example.test', bffSecret: 'backend-secret', allowInsecureHttp: false };
const sessionToken = 'A'.repeat(43);
const validSession = { sessionToken, expiresAt: '2100-01-01T00:00:00.000Z' };
const transaction = { state: 'expected-state', nonce: 'nonce', verifier: 'verifier', redirectUri: config.redirectUri, createdAt: 123 };
const req = () => new Request('https://untrusted.example.test/api/auth/callback?state=expected-state&code=private-code');

beforeEach(() => {
  vi.resetAllMocks();
  mocks.webConfig.mockReturnValue(config);
  mocks.readTransactionCookie.mockResolvedValue(transaction);
  mocks.completeLogin.mockResolvedValue({ id_token: 'private-id-token', access_token: 'private-access-token' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(validSession), { status: 201 })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('sign-in callback recovery', () => {
  it('completes sign-in using the configured callback origin and sets the session', async () => {
    const res = await GET(req());
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://shop.example.test/account');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const callback = mocks.completeLogin.mock.calls[0]![1] as URL;
    expect(callback.origin).toBe('https://shop.example.test');
    expect(callback.searchParams.get('code')).toBe('private-code');
    expect(mocks.setSessionCookie).toHaveBeenCalledWith(res, sessionToken, validSession.expiresAt);
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'manual' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(mocks.clearTransactionCookie).toHaveBeenCalledWith(res);
  });

  it.each(['config', 'cookie-read', 'missing-transaction', 'provider', 'missing-id-token', 'session-api', 'session-cookie'] as const)(
    'clears the transaction and safely redirects when %s fails', async failure => {
      if (failure === 'config') mocks.webConfig.mockImplementation(() => { throw new Error('secret-value'); });
      if (failure === 'cookie-read') mocks.readTransactionCookie.mockRejectedValue(new Error('secret-value'));
      if (failure === 'missing-transaction') mocks.readTransactionCookie.mockResolvedValue(null);
      if (failure === 'provider') mocks.completeLogin.mockRejectedValue(new Error('secret-value'));
      if (failure === 'missing-id-token') mocks.completeLogin.mockResolvedValue({ access_token: 'private-access-token' });
      if (failure === 'session-api') vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 502 }));
      if (failure === 'session-cookie') mocks.setSessionCookie.mockImplementation(() => { throw new Error('secret-value'); });
      const res = await GET(req());
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(failure === 'config' ? '/login?error=unavailable' : failure === 'session-api' || failure === 'session-cookie' ? '/login?error=session' : '/login?error=oidc');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(mocks.clearTransactionCookie).toHaveBeenCalledWith(res);
      const body = await res.text();
      for (const secret of ['secret-value', 'private-code', 'private-id-token', 'untrusted.example.test']) expect(body).not.toContain(secret);
      if (failure !== 'session-cookie') expect(mocks.setSessionCookie).not.toHaveBeenCalled();
    },
  );
  it.each([{ purpose: 'link' }, { redirectUri: 'https://shop.example.test/api/auth/link/callback' }])('rejects a link or wrong-callback transaction before provider exchange', async changes => {
    mocks.readTransactionCookie.mockResolvedValue({ ...transaction, ...changes });
    const res = await GET(req());
    expect(res.headers.get('location')).toBe('/login?error=oidc');
    expect(mocks.completeLogin).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });
  it.each([
    ['null', null], ['empty body', {}], ['token missing', { expiresAt: validSession.expiresAt }],
    ['token wrong type', { ...validSession, sessionToken: {} }], ['token empty', { ...validSession, sessionToken: '' }],
    ['token too short', { ...validSession, sessionToken: 'A'.repeat(42) }], ['token too long', { ...validSession, sessionToken: 'A'.repeat(44) }],
    ['token unsafe characters', { ...validSession, sessionToken: 'A'.repeat(42) + ';' }], ['token newline', { ...validSession, sessionToken: sessionToken + '\n' }],
    ['expiry missing', { sessionToken }], ['expiry wrong type', { ...validSession, expiresAt: 123 }],
    ['expiry invalid date', { ...validSession, expiresAt: '2100-02-30T00:00:00.000Z' }],
    ['expiry bad text', { ...validSession, expiresAt: 'private backend detail' }], ['expiry in the past', { ...validSession, expiresAt: '2000-01-01T00:00:00.000Z' }],
    ['expiry non-UTC', { ...validSession, expiresAt: '2100-01-01T00:00:00+00:00' }],
  ])('does not set a cookie or claim success for %s', async (_label, body) => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status: 201 }));
    const res = await GET(req());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login?error=session');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(mocks.clearTransactionCookie).toHaveBeenCalledWith(res);
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
    expect(await res.text()).not.toContain('private backend detail');
  });
  it.each([200, 204, 301, 401, 500])('treats session API status %s as unconfirmed', async status => {
    vi.mocked(fetch).mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(validSession), { status }));
    const res = await GET(req());
    expect(res.headers.get('location')).toBe('/login?error=session');
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
    expect(mocks.clearTransactionCookie).toHaveBeenCalledWith(res);
  });
  it('treats malformed JSON or a lost network response as unconfirmed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('invalid', { status: 201 })).mockRejectedValueOnce(new Error('network failed'));
    for (let i = 0; i < 2; i++) {
      const res = await GET(req());
      expect(res.headers.get('location')).toBe('/login?error=session');
      expect(mocks.setSessionCookie).not.toHaveBeenCalled();
      expect(mocks.clearTransactionCookie).toHaveBeenCalledWith(res);
    }
  });
  it('treats a stalled session request as unconfirmed without exposing tokens', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort());
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException('aborted', 'AbortError');
    });
    const res = await GET(req());
    expect(res.headers.get('location')).toBe('/login?error=session');
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
    expect(mocks.clearTransactionCookie).toHaveBeenCalledWith(res);
    expect(JSON.stringify([...res.headers])).not.toContain('private-id-token');
  });
  it('accepts UTC expiry without fractional seconds and a valid base64url token', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ sessionToken: 'aB_-'.repeat(10) + 'Ab_', expiresAt: '2100-01-01T00:00:00Z' }), { status: 201 }));
    expect((await GET(req())).headers.get('location')).toBe('https://shop.example.test/account');
    expect(mocks.setSessionCookie).toHaveBeenCalledTimes(1);
  });
});

describe('OAuth callback referrer headers', () => {
  it('overrides the global referrer policy for both OAuth callbacks', async () => {
    const { default: config } = await import('../next.config');
    const rules = await config.headers!();
    const header = (source: string) => rules.find(rule => rule.source === source)?.headers.find(item => item.key.toLowerCase() === 'referrer-policy')?.value;
    expect(header('/(.*)')).toBe('strict-origin-when-cross-origin');
    expect(header('/api/auth/callback')).toBe('no-referrer');
    expect(header('/api/auth/link/callback')).toBe('no-referrer');
    expect(rules.findIndex(rule => rule.source === '/api/auth/callback')).toBeGreaterThan(rules.findIndex(rule => rule.source === '/(.*)'));
  });
});
