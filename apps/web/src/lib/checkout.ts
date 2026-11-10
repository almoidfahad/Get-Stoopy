import type { QuoteCreateValue, QuoteReleaseValue } from '@getstoopy/core';
import { cartFetch, getOrCreateCart } from './cart';
import { commerceFailure } from './commerce-response';

/**
 * Server-side access to the checkout quote API.
 *
 * A quote reserves stock; it is not an order and it takes no money. Every call
 * goes through `cartFetch`, which attaches the session cookie, the origin and the
 * session-derived CSRF token on the server. The browser never sees the API URL,
 * the cookie or the token.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface QuoteCallResult {
  status: number;
  body: unknown;
}

/** Reserve stock for the current cart and return the quote. */
export async function createQuote(value: QuoteCreateValue): Promise<QuoteCallResult> {
  const cart = await getOrCreateCart();
  if (cart.state === 'sign-in') return { status: 401, body: { code: 'SIGN_IN_REQUIRED' } };
  if (cart.state === 'not-configured') return { status: 409, body: { code: 'MARKET_NOT_CONFIGURED' } };
  if (cart.state !== 'ok') return { status: 502, body: { code: 'QUOTE_UNAVAILABLE' } };
  return call(`/commerce/carts/${cart.cart.cartId}/quotes`, {
    method: 'POST',
    body: JSON.stringify({
      destinationCityId: value.destinationCityId,
      expectedVersion: value.expectedVersion,
      commandKey: value.commandKey,
    }),
  });
}

/** Read a quote the signed-in user owns. The API enforces ownership. */
export async function readQuote(quoteId: string): Promise<QuoteCallResult> {
  if (!UUID_RE.test(quoteId)) return { status: 404, body: { code: 'CHECKOUT_QUOTE_NOT_FOUND' } };
  return call(`/commerce/quotes/${quoteId}`, { method: 'GET' });
}

/** Give the reserved stock back. */
export async function releaseQuote(quoteId: string, value: QuoteReleaseValue): Promise<QuoteCallResult> {
  if (!UUID_RE.test(quoteId)) return { status: 404, body: { code: 'CHECKOUT_QUOTE_NOT_FOUND' } };
  return call(`/commerce/quotes/${quoteId}/release`, { method: 'POST', body: JSON.stringify(value) });
}

async function call(path: string, init: RequestInit): Promise<QuoteCallResult> {
  let res: Response | null;
  try {
    res = await cartFetch(path, init);
  } catch {
    return { status: 502, body: { code: 'QUOTE_UNAVAILABLE' } };
  }
  if (!res) return { status: 401, body: { code: 'SIGN_IN_REQUIRED' } };
  const expectedSuccess = res.status === 200 || (init.method === 'POST' && res.status === 201);
  if (!expectedSuccess) return commerceFailure(res, 'QUOTE_UNAVAILABLE');
  try {
    const body: unknown = await res.json();
    return { status: res.status, body };
  } catch {
    // Even with successful headers, a stalled or unreadable body cannot prove
    // the result of a reservation or release.
    return { status: 502, body: { code: 'QUOTE_UNAVAILABLE' } };
  }
}
