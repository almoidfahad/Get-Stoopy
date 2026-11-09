import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/bff', () => ({ apiFetch: mocks.apiFetch }));
import Account from '../src/app/account/page';

async function render() { return renderToStaticMarkup(await Account()); }
beforeEach(() => vi.resetAllMocks());

describe('account page', () => {
  it('shows signed-out state only for an unauthenticated response', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(null, { status: 401 }));
    const html = await render();
    expect(mocks.apiFetch).toHaveBeenCalledWith('/auth/me');
    expect(html).toContain('Sign in to your account');
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('Account temporarily unavailable');
  });
  it.each([403, 500])('shows an unavailable state for HTTP %s, not a false signed-out state', async status => {
    mocks.apiFetch.mockResolvedValue(new Response(null, { status }));
    const html = await render();
    expect(html).toContain('Account temporarily unavailable');
    expect(html).not.toContain('You are not signed in');
  });
  it('treats network or configuration errors as unavailable', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('service unreachable'));
    const html = await render();
    expect(html).toContain('Account temporarily unavailable');
    expect(html).toMatch(/<a href="\/account"[^>]*>Try again/);
    expect(html).not.toContain('service unreachable');
  });
  it('treats invalid response JSON as unavailable', async () => {
    mocks.apiFetch.mockResolvedValue(new Response('{not-json', { status: 200 }));
    expect(await render()).toContain('Account temporarily unavailable');
  });
  it.each([{}, { user: { id: 'u', assurance: 'PASSWORD' }, permissions: 'admin' }, { user: { id: '', assurance: 'PASSWORD' }, permissions: [] }])('does not claim a session for malformed data', async data => {
    mocks.apiFetch.mockResolvedValue(Response.json(data));
    expect(await render()).toContain('Account temporarily unavailable');
  });
  it('shows only real session fields, access details and the existing sign-out action', async () => {
    mocks.apiFetch.mockResolvedValue(Response.json({ user: { id: 'actual-user-id', assurance: 'PASSWORD' }, permissions: ['catalog.read'], csrfToken: 'do-not-render', vendorMemberships: [] }));
    const html = await render();
    expect(html).toContain('actual-user-id');
    expect(html).toContain('PASSWORD');
    expect(html).toContain('catalog.read');
    expect(html).toContain('<details');
    expect(html).toContain('action="/api/auth/logout"');
    expect(html).toContain('method="post"');
    expect(html).toContain('sign-in provider or other devices may stay signed in');
    expect(html).toContain('href="/cart"');
    expect(html).not.toContain('do-not-render');
    expect(html).not.toContain('href="/orders"');
  });
  it('states when no permissions are assigned', async () => {
    mocks.apiFetch.mockResolvedValue(Response.json({ user: { id: 'u', assurance: 'PASSWORD' }, permissions: [] }));
    expect(await render()).toContain('None assigned');
  });
});
