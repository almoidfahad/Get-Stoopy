import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashToken } from '@getstoopy/auth';
import { csrfTokenForSession } from '@getstoopy/bff';

const mocks = vi.hoisted(() => ({ webConfig: vi.fn(), beginLogin: vi.fn(), completeLogin: vi.fn(), setTransactionCookie: vi.fn(), readTransactionCookie: vi.fn(), clearTransactionCookie: vi.fn(), readSessionCookie: vi.fn(), apiFetch: vi.fn() }));
vi.mock('@/lib/config', () => ({ webConfig: mocks.webConfig }));
vi.mock('@/lib/bff', () => ({ setTransactionCookie: mocks.setTransactionCookie, readTransactionCookie: mocks.readTransactionCookie, clearTransactionCookie: mocks.clearTransactionCookie, readSessionCookie: mocks.readSessionCookie, apiFetch: mocks.apiFetch }));
vi.mock('@getstoopy/bff', async importOriginal => ({ ...await importOriginal<typeof import('@getstoopy/bff')>(), beginLogin: mocks.beginLogin, completeLogin: mocks.completeLogin }));
import { GET as start } from '../src/app/api/auth/link/start/route';
import { GET as callback } from '../src/app/api/auth/link/callback/route';

const config = { issuer: 'https://identity.example.test', clientId: 'client', clientSecret: 'private-secret', webOrigin: 'https://shop.example.test', allowInsecureHttp: false };
const token = 'A'.repeat(43), redirectUri = config.webOrigin + '/api/auth/link/callback';
const tx = { purpose: 'link' as const, sessionHash: hashToken(token), state: 'state', nonce: 'nonce', verifier: 'verifier', redirectUri, createdAt: Date.now() };
const request = () => new Request('https://attacker.example/api/auth/link/callback?code=private-code&state=state');
beforeEach(() => {
  vi.resetAllMocks();
  mocks.webConfig.mockReturnValue(config);
  mocks.readSessionCookie.mockResolvedValue(token);
  mocks.readTransactionCookie.mockResolvedValue(tx);
  mocks.apiFetch.mockResolvedValue(Response.json({ linked: true, issuer: config.issuer }, { status: 201 }));
  mocks.beginLogin.mockResolvedValue({ url: 'https://identity.example.test/authorize', transaction: { ...tx, purpose: undefined, sessionHash: undefined } });
  mocks.completeLogin.mockResolvedValue({ id_token: 'private-id-token' });
});

describe('identity linking start', () => {
  it('binds the provider transaction to the active session without storing the token', async () => {
    mocks.apiFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    const res = await start();
    expect(res.status).toBe(307);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(mocks.apiFetch).toHaveBeenCalledWith('/auth/me', expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) }));
    const stored = mocks.setTransactionCookie.mock.calls[0]![1];
    expect(stored).toMatchObject({ purpose: 'link', sessionHash: hashToken(token), redirectUri });
    expect(JSON.stringify(stored)).not.toContain(token);
  });
  it.each([['missing', undefined, '/login'], ['malformed', 'bad', '/account?link=unavailable']] as const)('stops for %s session', async (_name, session, location) => {
    mocks.readSessionCookie.mockResolvedValue(session);
    const res = await start();
    expect(res.headers.get('location')).toBe(location);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(mocks.beginLogin).not.toHaveBeenCalled();
  });
  it.each([[401, '/login'], [302, '/account?link=unavailable'], [403, '/account?link=unavailable'], [500, '/account?link=unavailable']] as const)('does not claim signed-out for HTTP %s unless 401', async (status, location) => {
    mocks.apiFetch.mockResolvedValue(new Response(null, { status }));
    const res = await start();
    expect(res.headers.get('location')).toBe(location);
    expect(mocks.beginLogin).not.toHaveBeenCalled();
  });
  it.each(['config', 'network', 'provider', 'cookie'])('recovers from %s failure without exposing details', async failure => {
    mocks.apiFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    if (failure === 'config') mocks.webConfig.mockImplementation(() => { throw Error('private-secret'); });
    if (failure === 'network') mocks.apiFetch.mockRejectedValue(Error('private-secret'));
    if (failure === 'provider') mocks.beginLogin.mockRejectedValue(Error('private-secret'));
    if (failure === 'cookie') mocks.setTransactionCookie.mockRejectedValue(Error('private-secret'));
    const res = await start();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/account?link=unavailable');
    expect(await res.text()).not.toContain('private-secret');
  });
});

describe('identity linking callback', () => {
  it('only reports a valid 201 link result and uses the bound session CSRF', async () => {
    const res = await callback(request());
    expect(res.headers.get('location')).toBe('/account?link=success');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(mocks.clearTransactionCookie).toHaveBeenCalledWith(res);
    const url = mocks.completeLogin.mock.calls[0]![1] as URL;
    expect(url.origin).toBe(config.webOrigin);
    expect(url.searchParams.get('code')).toBe('private-code');
    expect(mocks.apiFetch).toHaveBeenCalledWith('/auth/identities/link', expect.objectContaining({ method: 'POST', redirect: 'manual', signal: expect.any(AbortSignal), headers: expect.objectContaining({ origin: config.webOrigin, 'x-csrf-token': csrfTokenForSession(token) }), body: JSON.stringify({ idToken: 'private-id-token' }) }));
  });
  it.each(['missing-tx', 'wrong-purpose', 'wrong-callback', 'old-unbound', 'invalid-hash', 'changed-session', 'missing-session', 'invalid-session'])('rejects %s before token exchange or linking', async failure => {
    if (failure === 'missing-tx') mocks.readTransactionCookie.mockResolvedValue(null);
    if (failure === 'wrong-purpose') mocks.readTransactionCookie.mockResolvedValue({ ...tx, purpose: undefined });
    if (failure === 'wrong-callback') mocks.readTransactionCookie.mockResolvedValue({ ...tx, redirectUri: config.webOrigin + '/api/auth/callback' });
    if (failure === 'old-unbound') mocks.readTransactionCookie.mockResolvedValue({ ...tx, sessionHash: undefined });
    if (failure === 'invalid-hash') mocks.readTransactionCookie.mockResolvedValue({ ...tx, sessionHash: 'invalid' });
    if (failure === 'changed-session') mocks.readSessionCookie.mockResolvedValue('B'.repeat(43));
    if (failure === 'missing-session') mocks.readSessionCookie.mockResolvedValue(undefined);
    if (failure === 'invalid-session') mocks.readSessionCookie.mockResolvedValue('bad');
    const res = await callback(request());
    expect(res.headers.get('location')).toBe('/account?link=failed');
    expect(mocks.completeLogin).not.toHaveBeenCalled();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(mocks.clearTransactionCookie).toHaveBeenCalledWith(res);
  });
  it.each(['config', 'cookie', 'exchange', 'id-token'])('handles %s failure without sending link', async failure => {
    if (failure === 'config') mocks.webConfig.mockImplementation(() => { throw Error('private-secret'); });
    if (failure === 'cookie') mocks.readTransactionCookie.mockRejectedValue(Error('private-secret'));
    if (failure === 'exchange') mocks.completeLogin.mockRejectedValue(Error('private-secret'));
    if (failure === 'id-token') mocks.completeLogin.mockResolvedValue({});
    const res = await callback(request());
    expect(res.headers.get('location')).toBe('/account?link=failed');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(await res.text()).not.toContain('private-secret');
  });
  it.each([200, 204, 301, 401, 409, 500])('does not claim success for HTTP %s', async status => {
    mocks.apiFetch.mockResolvedValue(new Response(status === 204 ? null : '{}', { status }));
    const res = await callback(request());
    expect(res.headers.get('location')).toBe('/account?link=unconfirmed');
  });
  it.each([{}, { linked: false, issuer: config.issuer }, { linked: true, issuer: 'https://wrong.example' }])('does not claim success for malformed result', async body => {
    mocks.apiFetch.mockResolvedValue(Response.json(body, { status: 201 }));
    expect((await callback(request())).headers.get('location')).toBe('/account?link=unconfirmed');
  });
  it.each(['invalid-json', 'lost-response'])('marks %s as unconfirmed without retry', async mode => {
    if (mode === 'invalid-json') mocks.apiFetch.mockResolvedValue(new Response('{', { status: 201 }));
    else mocks.apiFetch.mockRejectedValue(Error('private-secret'));
    const res = await callback(request());
    expect(res.headers.get('location')).toBe('/account?link=unconfirmed');
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
  });
});
