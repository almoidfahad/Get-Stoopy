import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/bff', () => ({ apiFetch: mocks.apiFetch }));
import AdminDashboard from '../src/app/admin/page';
async function render() { return renderToStaticMarkup(await AdminDashboard()); }
beforeEach(() => vi.resetAllMocks());

describe('admin dashboard layout', () => {
  it('shows a public layout without fictional metrics or working admin links', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(null, { status: 401 }));
    const html = await render();
    expect(mocks.apiFetch).toHaveBeenCalledWith('/auth/me');
    expect(html).toContain('Sign in to your account');
    expect(html).toContain('href="/login"');
    expect(html).toContain('Sales overview');
    expect(html).toContain('Regional overview');
    expect(html).toContain('System health');
    expect(html).toContain('Dashboard metrics are not connected');
    expect(html).toContain('Modules not yet available');
    expect(html).toContain('href="/admin/review-preview"');
    expect(html).toContain('Explore review layout preview');
    expect(html).not.toContain('Rahman Hossain');
    expect(html).not.toContain('$48,750');
    expect(html).not.toContain('All Systems Operational');
    expect(html).not.toContain('href="/admin/orders"');
  });
  it('does not imply a normal session has admin authorization or expose sensitive fields', async () => {
    mocks.apiFetch.mockResolvedValue(Response.json({ user: { id: 'private-user' }, permissions: ['admin'], scopes: [{ countryId: 'private-country' }], csrfToken: 'secret-csrf' }));
    const html = await render();
    expect(html).toContain('Account session found');
    expect(html).toContain('does not verify admin permissions or geographic scope');
    expect(html).not.toContain('private-user');
    expect(html).not.toContain('private-country');
    expect(html).not.toContain('secret-csrf');
    expect(html).not.toContain('Admin access granted');
  });
  it.each([403, 500])('does not mistake HTTP %s for a signed-out session', async status => {
    mocks.apiFetch.mockResolvedValue(new Response(null, { status }));
    const html = await render();
    expect(html).toContain('Account session could not be checked');
    expect(html).not.toContain('Sign in to your account');
  });
  it('treats network or configuration failures as unavailable', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('unavailable'));
    const html = await render();
    expect(html).toContain('Account session could not be checked');
    expect(html).toMatch(/<a href="\/admin"[^>]*>Try again<\/a>/);
  });
  it.each([{}, { user: {} }, { user: { id: '' } }, { user: { id: 3 } }])('fails closed on malformed session data', async data => {
    mocks.apiFetch.mockResolvedValue(Response.json(data));
    const html = await render();
    expect(html).toContain('Account session could not be checked');
    expect(html).not.toContain('Account session found');
  });
});
