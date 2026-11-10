import { cookies } from 'next/headers';
import { csrfTokenForSession } from '@getstoopy/bff';
import type { CartLineInput } from '@getstoopy/core';
import { webConfig } from './config';
import { marketCountryId } from './catalog';
import { commerceFailure } from './commerce-response';

/**
 * Server-side access to the session-scoped cart API.
 *
 * Cart identity is never stored in a browser cookie. The API enforces a unique
 * cart per (user, country) and makes creation idempotent, so `POST /commerce/carts`
 * is a get-or-create. That removes a whole class of bugs: no stale cart id after
 * logout, and no way for one signed-in user to pick up another user's cart id.
 *
 * Mutations carry the origin and a session-derived CSRF token, matching the API's
 * CsrfGuard. The browser never sees either.
 */

export interface CartItem extends CartLineInput {
  id: string;
  productId: string;
  title: string;
  storeName: string;
  storeId: string;
  vendorId: string;
}

export interface Cart {
  cartId: string;
  countryId: string;
  currency: string;
  version: number;
  /** Set when a RESERVED quote is still holding this cart's stock. */
  activeQuoteId: string | null;
  items: CartItem[];
  duplicate?: boolean;
}

export type CartResult =
  | { state: 'ok'; cart: Cart }
  | { state: 'sign-in' }
  | { state: 'not-configured' }
  | { state: 'unavailable' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: unknown): value is string { return typeof value === 'string' && UUID_RE.test(value); }

/** Check data needed for rendering and mutation routing, not ownership or prices. */
function isCartResponse(value: unknown, countryId: string): value is Cart {
  if (!value || typeof value !== 'object') return false;
  const cart = value as Record<string, unknown>;
  if (!isUuid(cart.cartId) || !isUuid(cart.countryId) || cart.countryId.toLowerCase() !== countryId.toLowerCase() ||
      typeof cart.currency !== 'string' || !Number.isSafeInteger(cart.version) || (cart.version as number) < 1 ||
      !(cart.activeQuoteId === null || isUuid(cart.activeQuoteId)) || !Array.isArray(cart.items)) return false;
  const ids = new Set<string>();
  const variants = new Set<string>();
  for (const raw of cart.items) {
    if (!raw || typeof raw !== 'object') return false;
    const item = raw as Record<string, unknown>;
    if (!isUuid(item.id) || !isUuid(item.variantId) || !isUuid(item.productId) || !isUuid(item.storeId) || !isUuid(item.vendorId) ||
        typeof item.title !== 'string' || typeof item.storeName !== 'string' || typeof item.currency !== 'string' ||
        typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) ||
        typeof item.unitPriceMinor !== 'string' || typeof item.lineTotalMinor !== 'string' ||
        typeof item.availableToPromise !== 'number' || !Number.isSafeInteger(item.availableToPromise) || item.availableToPromise < 0 ||
        typeof item.sellable !== 'boolean') return false;
    const id = item.id.toLowerCase();
    const variant = item.variantId.toLowerCase();
    if (ids.has(id) || variants.has(variant)) return false;
    ids.add(id); variants.add(variant);
  }
  return true;
}

async function sessionToken(): Promise<string | null> {
  const cfg = webConfig();
  return (await cookies()).get(cfg.sessionCookieName)?.value ?? null;
}

export async function cartFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = await sessionToken();
  if (!token) return null;
  const cfg = webConfig();
  const headers = new Headers(init.headers);
  headers.set('cookie', `${cfg.sessionCookieName}=${token}`);
  const method = (init.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('origin', cfg.webOrigin);
    headers.set('x-csrf-token', csrfTokenForSession(token));
    if (init.body) headers.set('content-type', 'application/json');
  }
  // Do not forward session or CSRF credentials to a redirect target. The
  // deadline remains active while callers consume the response body.
  const timeout = AbortSignal.timeout(8_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(`${cfg.apiUrl}/api/v1${path}`, { ...init, headers, cache: 'no-store', redirect: 'manual', signal });
}

/** Whether a session cookie is present. Authorization is still decided by the API. */
export async function hasSessionCookie(): Promise<boolean> {
  return (await sessionToken()) !== null;
}

/** Idempotent get-or-create for the signed-in user's cart in this market. */
export async function getOrCreateCart(): Promise<CartResult> {
  const countryId = marketCountryId();
  if (!countryId) return { state: 'not-configured' };
  try {
    const res = await cartFetch('/commerce/carts', { method: 'POST', body: JSON.stringify({ countryId }) });
    if (!res || res.status === 401) return { state: 'sign-in' };
    if (res.status !== 200 && res.status !== 201) return { state: 'unavailable' };
    const cart: unknown = await res.json();
    if (!isCartResponse(cart, countryId)) return { state: 'unavailable' };
    return { state: 'ok', cart };
  } catch {
    return { state: 'unavailable' };
  }
}

export interface CartMutationInput {
  variantId: string;
  quantity?: number;
  expectedVersion?: number;
}

export interface CartMutationResult {
  status: number;
  body: unknown;
}

/**
 * Apply a cart change.
 *
 * For `add`, the current cart version is resolved server-side so a product page
 * left open for an hour still works. For `update` and `remove`, the version the
 * buyer actually saw is required and forwarded, so a concurrent change produces a
 * 409 the UI can explain instead of silently overwriting someone's edit.
 */
export async function mutateCart(
  op: 'add' | 'update' | 'remove',
  input: CartMutationInput,
): Promise<CartMutationResult> {
  const cart = await getOrCreateCart();
  if (cart.state === 'sign-in') return { status: 401, body: { code: 'SIGN_IN_REQUIRED' } };
  if (cart.state === 'not-configured') return { status: 409, body: { code: 'MARKET_NOT_CONFIGURED' } };
  if (cart.state !== 'ok') return { status: 502, body: { code: 'CART_UNAVAILABLE' } };

  const expectedVersion = op === 'add' ? cart.cart.version : input.expectedVersion;
  if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 1) {
    return { status: 400, body: { code: 'VERSION_INVALID' } };
  }

  const base = `/commerce/carts/${cart.cart.cartId}/items`;
  let res: Response | null;
  try {
    if (op === 'add') {
      res = await cartFetch(base, {
        method: 'POST',
        body: JSON.stringify({ variantId: input.variantId, quantity: input.quantity, expectedVersion }),
      });
    } else if (op === 'update') {
      res = await cartFetch(`${base}/${input.variantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity: input.quantity, expectedVersion }),
      });
    } else {
      res = await cartFetch(`${base}/${input.variantId}?expectedVersion=${expectedVersion}`, { method: 'DELETE' });
    }
  } catch {
    return { status: 502, body: { code: 'CART_RESULT_UNKNOWN' } };
  }
  if (!res) return { status: 401, body: { code: 'SIGN_IN_REQUIRED' } };
  const expectedSuccess = res.status === 200 || (op === 'add' && res.status === 201);
  if (!expectedSuccess) return commerceFailure(res, 'CART_RESULT_UNKNOWN');
  const body: unknown = await res.json().catch(() => null);

  // A successful HTTP status does not establish what the mutation did. Check
  // the returned cart and the specific line before confirming it to the client.
  if (!isCartResponse(body, cart.cart.countryId) || body.cartId.toLowerCase() !== cart.cart.cartId.toLowerCase() ||
      body.version <= (expectedVersion as number)) return { status: 502, body: { code: 'CART_RESULT_UNKNOWN' } };
  const updated = body.items.find(item => item.variantId.toLowerCase() === input.variantId.toLowerCase());
  const previous = cart.cart.items.find(item => item.variantId.toLowerCase() === input.variantId.toLowerCase());
  const matches = op === 'remove' ? !updated : op === 'update' ? updated?.quantity === input.quantity :
    typeof input.quantity === 'number' && updated?.quantity === (previous?.quantity ?? 0) + input.quantity;
  if (!matches) return { status: 502, body: { code: 'CART_RESULT_UNKNOWN' } };
  return { status: res.status, body: { ...body, mutationConfirmed: true } };
}

export { parseCartMutation } from '@getstoopy/core';
