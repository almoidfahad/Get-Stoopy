import { marketCountryId } from '@/lib/catalog';
import { webConfig } from '@/lib/config';

/**
 * Same-origin proxy for approved public product images.
 *
 * The browser must never learn the internal API URL, and this route must not be
 * usable as an open redirect or SSRF primitive: the upstream path is assembled
 * only from UUID-validated segments and a configured country id, never from a
 * caller-supplied URL, and no session cookie is forwarded for a public asset.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
): Promise<Response> {
  const { id, imageId } = await params;
  const countryId = marketCountryId();
  if (!countryId) return new Response('Not found', { status: 404 });
  if (!UUID_RE.test(id) || !UUID_RE.test(imageId)) return new Response('Not found', { status: 404 });

  let upstream: Response;
  try {
    const cfg = webConfig();
    upstream = await fetch(
      `${cfg.apiUrl}/api/v1/public/catalog/products/${id}/images/${imageId}?countryId=${countryId}`,
      { cache: 'no-store' },
    );
  } catch {
    return new Response('Unavailable', { status: 502 });
  }

  if (!upstream.ok) return new Response('Not found', { status: upstream.status === 404 ? 404 : 502 });

  const contentType = (upstream.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!ALLOWED_TYPES.has(contentType)) return new Response('Unsupported media type', { status: 415 });

  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox",
    },
  });
}