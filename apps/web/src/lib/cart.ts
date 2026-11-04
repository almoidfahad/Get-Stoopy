import { cookies } from 'next/headers';
import { csrfTokenForSession } from '@getstoopy/bff';
import type { CartLineInput } from '@getstoopy/core';
import { webConfig } from './config';
import { marketCountryId } from './catalog';

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
  items: CartItem[];
  duplicate?: boolean;
}

export type CartResult =
  | { state: 'ok'; cart: Cart }
  | { state: 'sign-in' }
  | { state: 'not-configured' }
  | { state: 'unavailable' };

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
  return fetch(`${cfg.apiUrl}/api/v1${path}`, { ...init, headers, cache: 'no-store' });
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
    if (!res) return { state: 'sign-in' };
    if (!res.ok) return { state: 'unavailable' };
    return { state: 'ok', cart: (await res.json()) as Cart };
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
    return { status: 502, body: { code: 'CART_UNAVAILABLE' } };
  }
  if (!res) return { status: 401, body: { code: 'SIGN_IN_REQUIRED' } };
  const body = await res.json().catch(() => ({ code: 'CART_UNAVAILABLE' }));
  return { status: res.status, body };
}

export { parseCartMutation } from '@getstoopy/core';
