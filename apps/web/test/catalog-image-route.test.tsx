import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ market: vi.fn(), config: vi.fn() }));
vi.mock('@/lib/catalog', () => ({ marketCountryId: mocks.market }));
vi.mock('@/lib/config', () => ({ webConfig: mocks.config }));
import { GET } from '../src/app/api/catalog/products/[id]/images/[imageId]/route';

const id = '11111111-1111-4111-8111-111111111111';
const imageId = '22222222-2222-4222-8222-222222222222';
const params = { params: Promise.resolve({ id, imageId }) };
const request = new Request('https://shop.test/api/image?retry=2&url=https://example.com');
beforeEach(() => { vi.clearAllMocks(); mocks.market.mockReturnValue(id); mocks.config.mockReturnValue({ apiUrl: 'https://api.example.test' }); });
afterEach(() => vi.unstubAllGlobals());

describe('public catalog image proxy', () => {
  it.each([404, 500])('does not cache upstream failure %s', async code => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: code }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(request, params);
    expect(response.status).toBe(code === 404 ? 404 : 502);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://api.example.test/api/v1/public/catalog/products/${id}/images/${imageId}?countryId=${id}`);
  });
  it('does not cache missing configuration, invalid IDs, network errors or unsupported types', async () => {
    mocks.market.mockReturnValueOnce(null);
    expect((await GET(request, params)).headers.get('cache-control')).toBe('no-store');
    expect((await GET(request, { params: Promise.resolve({ id: 'bad', imageId }) })).headers.get('cache-control')).toBe('no-store');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response('no', { headers: { 'content-type': 'text/html' } })));
    const offline = await GET(request, params);
    const unsupported = await GET(request, params);
    expect(offline.status).toBe(502);
    expect(unsupported.status).toBe(415);
    expect(offline.headers.get('cache-control')).toBe('no-store');
    expect(unsupported.headers.get('cache-control')).toBe('no-store');
  });
  it('still delivers allowed images without caching', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('image', { headers: { 'content-type': 'image/png' } })));
    const response = await GET(request, params);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
