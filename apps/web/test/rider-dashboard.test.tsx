import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/bff', () => ({ apiFetch: mocks.apiFetch }));
import RiderDashboard from '../src/app/rider/page';
async function render() { return renderToStaticMarkup(await RiderDashboard()); }
beforeEach(() => vi.resetAllMocks());

describe('rider dashboard layout', () => {
  it('shows a safe layout with unavailable reporting and no fictional rider data', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(null, { status: 401 }));
    const html = await render();
    expect(mocks.apiFetch).toHaveBeenCalledWith('/auth/me');
    expect(html).toContain('Sign in to check rider access');
    expect(html).toContain('href="/login"');
    expect(html).toContain('Live delivery');
    expect(html).toContain('Recent deliveries');
    expect(html).toContain('Dashboard metrics are not connected');
    expect(html).toContain('Modules not yet available');
    expect(html).not.toContain('Fahim');
    expect(html).not.toContain('$142.50');
    expect(html).not.toContain('href="/rider/deliveries"');
    expect(html).not.toContain('On Duty');
  });
  it('indicates an eligible profile without exposing IDs or claiming tools are connected', async () => {
    mocks.apiFetch.mockResolvedValue(Response.json({ user: { id: 'private-user' }, riderId: 'private-rider', csrfToken: 'secret-csrf' }));
    const html = await render();
    expect(html).toContain('Rider profile found');
    expect(html).toContain('Dashboard data and tools have not been connected yet');
    expect(html).not.toContain('private-rider');
    expect(html).not.toContain('secret-csrf');
  });
  it('states when no eligible rider profile is returned', async () => {
    mocks.apiFetch.mockResolvedValue(Response.json({ user: { id: 'user' }, riderId: null }));
    expect(await render()).toContain('No eligible rider profile found');
  });
  it.each([403, 500])('does not mistake HTTP %s for a signed-out session', async status => {
    mocks.apiFetch.mockResolvedValue(new Response(null, { status }));
    const html = await render();
    expect(html).toContain('Rider access could not be checked');
    expect(html).not.toContain('Sign in to check rider access');
  });
  it('treats network or configuration failures as unavailable', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('unavailable'));
    expect(await render()).toContain('Rider access could not be checked');
  });
  it.each([{}, { user: { id: 'u' } }, { user: { id: 'u' }, riderId: '' }, { user: { id: 'u' }, riderId: 3 }])('fails closed on malformed session data', async data => {
    mocks.apiFetch.mockResolvedValue(Response.json(data));
    const html = await render();
    expect(html).toContain('Rider access could not be checked');
    expect(html).not.toContain('Rider profile found');
  });
});
