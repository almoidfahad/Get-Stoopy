import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/bff', () => ({ apiFetch: mocks.apiFetch }));
import VendorDashboard from '../src/app/vendor/page';
async function render() { return renderToStaticMarkup(await VendorDashboard()); }
beforeEach(() => vi.resetAllMocks());

describe('vendor dashboard layout', () => {
  it('renders a usable layout with honest unavailable reporting for signed-out visitors', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(null, { status: 401 }));
    const html = await render();
    expect(mocks.apiFetch).toHaveBeenCalledWith('/auth/me');
    expect(html).toContain('Sign in to check vendor access');
    expect(html).toContain('href="/login"');
    expect(html).toContain('Sales overview');
    expect(html).toContain('Recent orders');
    expect(html).toContain('Dashboard metrics are not connected');
    expect(html).toContain('Modules not yet available');
    expect(html).toContain('href="/vendor/product-preview"');
    expect(html).toContain('Product layout preview');
    expect(html).toContain('href="/vendor/inventory"');
    expect(html).not.toContain('TechMart');
    expect(html).not.toContain('$12,580');
    expect(html).toContain('href="/vendor/orders"');
    expect(html).toContain('Orders layout preview');
  });
  it('recognizes membership but does not expose its IDs or claim reports are connected', async () => {
    mocks.apiFetch.mockResolvedValue(Response.json({ user: { id: 'private-user' }, vendorMemberships: [{ vendorId: 'private-vendor', countryId: 'country', storeId: 'private-store' }], csrfToken: 'secret-csrf' }));
    const html = await render();
    expect(html).toContain('Vendor membership found');
    expect(html).toContain('Dashboard data and tools have not been connected yet');
    expect(html).not.toContain('private-vendor');
    expect(html).not.toContain('private-store');
    expect(html).not.toContain('secret-csrf');
  });
  it('states when no active membership is returned', async () => {
    mocks.apiFetch.mockResolvedValue(Response.json({ user: { id: 'user' }, vendorMemberships: [] }));
    expect(await render()).toContain('No active vendor membership found');
  });
  it.each([403, 500])('does not mistake HTTP %s for a signed-out session', async status => {
    mocks.apiFetch.mockResolvedValue(new Response(null, { status }));
    const html = await render();
    expect(html).toContain('Vendor access could not be checked');
    expect(html).not.toContain('Sign in to check vendor access');
  });
  it('treats network or config failure as unavailable', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('unavailable'));
    const html = await render();
    expect(html).toContain('Vendor access could not be checked');
    expect(html).toMatch(/<a href="\/vendor"[^>]*>Try again<\/a>/);
  });
  it.each([{}, { user: { id: 'u' }, vendorMemberships: [{}] }, { user: { id: 'u' }, vendorMemberships: 'bad' }])('fails closed on invalid session data', async data => {
    mocks.apiFetch.mockResolvedValue(Response.json(data));
    const html = await render();
    expect(html).toContain('Vendor access could not be checked');
    expect(html).not.toContain('Vendor membership found');
  });
});
