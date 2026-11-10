import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ discovery: vi.fn(), allowInsecureRequests: vi.fn() }));
vi.mock('openid-client', () => ({ discovery: mocks.discovery, allowInsecureRequests: mocks.allowInsecureRequests }));
import { discover } from '../src/oidc';

const cfg = { clientId: 'client', clientSecret: 'fixture-secret', redirectUri: 'https://shop.example.test/api/auth/callback' };
beforeEach(() => { vi.clearAllMocks(); mocks.discovery.mockResolvedValue({ fixture: true }); });

describe('OIDC discovery transport policy', () => {
  it.each([
    ['https://identity.example.test/realm', true],
    ['https://identity.example.test/realm', false],
    ['https://127.0.0.1:8443/realm', true],
    ['https://identity.example.test/realm', undefined],
  ])('allows HTTPS issuer %s with development flag %s without enabling insecure requests', async (issuer, allowInsecureHttp) => {
    await expect(discover({ ...cfg, issuer, allowInsecureHttp })).resolves.toEqual({ fixture: true });
    expect(mocks.discovery).toHaveBeenCalledOnce();
    const args = mocks.discovery.mock.calls[0]!;
    expect((args[0] as URL).href).toBe(issuer);
    expect(args[1]).toBe(cfg.clientId);
    expect(args[2]).toBe(cfg.clientSecret);
    expect(args[3]).toBeUndefined();
    expect(args[4]).toBeUndefined();
    expect(mocks.allowInsecureRequests).not.toHaveBeenCalled();
  });
  it.each(['http://localhost:8080/realm', 'http://127.0.0.1:8080/realm', 'http://[::1]:8080/realm'])('allows explicit development HTTP only for %s', async issuer => {
    await discover({ ...cfg, issuer, allowInsecureHttp: true });
    expect(mocks.discovery).toHaveBeenCalledOnce();
    expect(mocks.discovery.mock.calls[0]![4]).toEqual({ execute: [mocks.allowInsecureRequests] });
  });
  it.each([
    ['http://localhost:8080/realm', false],
    ['http://127.0.0.1:8080/realm', undefined],
    ['http://[::1]:8080/realm', false],
    ['http://example.test/realm', true],
    ['http://localhost.example.test/realm', true],
    ['http://127.0.0.2:8080/realm', true],
    ['ftp://localhost/realm', true],
    ['file:///etc/passwd', true],
  ])('rejects unsupported/insecure issuer %s with development flag %s before network', async (issuer, allowInsecureHttp) => {
    await expect(discover({ ...cfg, issuer, allowInsecureHttp })).rejects.toThrow('INSECURE_OIDC_ONLY_LOCALHOST_DEV');
    expect(mocks.discovery).not.toHaveBeenCalled();
  });
});
