import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/bff', () => ({ apiFetch: mocks.apiFetch }));
import { readSession } from '../src/lib/session-read';
import { GET } from '../src/app/api/auth/me/route';

const valid = { user: { id: 'actual-user', assurance: 'PASSWORD' }, permissions: [], scopes: [], vendorMemberships: [], riderId: null, csrfToken: 'session-csrf' };
beforeEach(() => { vi.resetAllMocks(); mocks.apiFetch.mockResolvedValue(Response.json(valid)); });
afterEach(() => vi.restoreAllMocks());

describe('bounded session read', () => {
  it('uses manual redirects and a timeout and preserves the successful payload', async () => {
    expect(await readSession()).toEqual({ state: 'ok', data: valid });
    expect(mocks.apiFetch).toHaveBeenCalledWith('/auth/me', expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) }));
  });
  it('distinguishes a 401 from an unavailable account service', async () => {
    mocks.apiFetch.mockResolvedValue(new Response('private error', { status: 401 }));
    expect(await readSession()).toEqual({ state: 'signed-out' });
  });
  it.each([201, 202, 204, 301, 302, 307, 403, 429, 500, 503])('treats status %s as unavailable, even with session-shaped data', async status => {
    mocks.apiFetch.mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(valid), { status, headers: { location: 'https://attacker.example/' } }));
    expect(await readSession()).toEqual({ state: 'unavailable' });
  });
  it.each([null, [], {}, { user: null }, { user: [] }, { user: { id: '' } }, { user: { id: '   ' } }, { user: { id: 42 } }])('rejects a malformed successful body', async data => {
    mocks.apiFetch.mockResolvedValue(Response.json(data));
    expect(await readSession()).toEqual({ state: 'unavailable' });
  });
  it('does not expose a JSON parse or network error', async () => {
    mocks.apiFetch.mockResolvedValueOnce(new Response('{private error')).mockRejectedValueOnce(new Error('private error'));
    expect(await readSession()).toEqual({ state: 'unavailable' });
    expect(await readSession()).toEqual({ state: 'unavailable' });
  });
  it.each(['headers', 'body'])('returns unavailable when the %s read is aborted', async part => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort());
    if (part === 'headers') mocks.apiFetch.mockImplementation(async (_path, init) => {
      expect(init.signal.aborted).toBe(true);
      throw new DOMException('timeout', 'AbortError');
    });
    else mocks.apiFetch.mockImplementation(async (_path, init) => ({ status: 200, json: async () => {
      expect(init.signal.aborted).toBe(true);
      throw new DOMException('timeout', 'AbortError');
    } }));
    expect(await readSession()).toEqual({ state: 'unavailable' });
  });
});

describe('session BFF endpoint', () => {
  it('returns the complete valid session with no-store', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual(valid);
  });
  it('returns generic 401 rather than exposing the upstream body', async () => {
    mocks.apiFetch.mockResolvedValue(new Response('private backend error', { status: 401 }));
    const res = await GET();
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ code: 'SIGN_IN_REQUIRED' });
  });
  it.each([201, 301, 403, 500])('maps status %s to generic 502 without redirect or backend details', async status => {
    mocks.apiFetch.mockResolvedValue(new Response('private backend error', { status, headers: { location: 'https://attacker.example' } }));
    const res = await GET();
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('location')).toBeNull();
    expect(await res.json()).toEqual({ code: 'SESSION_UNAVAILABLE' });
  });
  it('returns generic 502 for malformed success or network error', async () => {
    mocks.apiFetch.mockResolvedValueOnce(Response.json({ detail: 'private backend error' })).mockRejectedValueOnce(new Error('private backend error'));
    for (let i = 0; i < 2; i++) {
      const res = await GET();
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ code: 'SESSION_UNAVAILABLE' });
    }
  });
});
