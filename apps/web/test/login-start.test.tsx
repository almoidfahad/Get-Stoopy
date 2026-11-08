import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ webConfig: vi.fn(), beginLogin: vi.fn(), setTransactionCookie: vi.fn() }));
vi.mock('@/lib/config', () => ({ webConfig: mocks.webConfig }));
vi.mock('@/lib/bff', () => ({ setTransactionCookie: mocks.setTransactionCookie }));
vi.mock('@getstoopy/bff', () => ({ beginLogin: mocks.beginLogin }));
import { GET } from '../src/app/api/auth/login/route';

const config = { issuer: 'https://identity.example.test', clientId: 'client', clientSecret: 'private-value', redirectUri: 'https://shop.example.test/api/auth/callback', allowInsecureHttp: false };
beforeEach(() => { vi.resetAllMocks(); mocks.webConfig.mockReturnValue(config); });

describe('sign-in start', () => {
  it('redirects to the provider and sets the transaction cookie on success', async () => {
    const transaction = { state: 'state-value' };
    mocks.beginLogin.mockResolvedValue({ url: 'https://identity.example.test/auth', transaction });
    const response = await GET();
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://identity.example.test/auth');
    expect(mocks.setTransactionCookie).toHaveBeenCalledWith(response, transaction);
  });
  it.each(['config', 'provider', 'cookie'])('returns a safe same-origin recovery redirect when %s fails', async source => {
    mocks.beginLogin.mockResolvedValue({ url: 'https://identity.example.test/auth', transaction: {} });
    if (source === 'config') mocks.webConfig.mockImplementation(() => { throw new Error('private-value'); });
    if (source === 'provider') mocks.beginLogin.mockRejectedValue(new Error('private-value'));
    if (source === 'cookie') mocks.setTransactionCookie.mockRejectedValue(new Error('private-value'));
    const response = await GET();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login?error=unavailable');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('private-value');
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
