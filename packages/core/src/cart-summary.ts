/**
 * Cart totals and availability checks, shared by the storefront and tests.
 *
 * The cart API already returns a line total, but a total the buyer is asked to
 * trust must be independently derivable. This module recomputes every line from
 * unit price × quantity and *flags* a disagreement with the server rather than
 * silently picking one, because a mismatch means a price moved mid-session and
 * the buyer must be told before ordering.
 *
 * Money is bigint throughout. Mixed currencies are never summed.
 */
import { MAX_CART_ITEMS, MAX_CART_LINE_QUANTITY, assertCartQuantity } from './checkout.js';
import { parseMinorUnits } from './catalog-display.js';

export interface CartLineInput {
  readonly variantId: string;
  readonly quantity: number;
  readonly unitPriceMinor: string;
  readonly lineTotalMinor: string;
  readonly currency: string;
  readonly availableToPromise: number;
  readonly sellable: boolean;
}

export type CartIssueKind =
  | 'not-sellable'
  | 'insufficient-stock'
  | 'quantity-invalid'
  | 'price-invalid'
  | 'line-total-mismatch'
  | 'currency-mismatch'
  | 'too-many-items';

export interface CartIssue {
  readonly variantId: string | null;
  readonly kind: CartIssueKind;
}

export interface CartSummary {
  readonly lineCount: number;
  readonly unitCount: number;
  /** null when the cart is empty, mixed-currency, or has an unpriceable line */
  readonly subtotalMinor: bigint | null;
  readonly currency: string | null;
  readonly issues: readonly CartIssue[];
  /** true only when there is at least one line and nothing needs buyer attention */
  readonly readyForCheckout: boolean;
}

export function summarizeCart(lines: readonly CartLineInput[]): CartSummary {
  const issues: CartIssue[] = [];
  let subtotal = 0n;
  let unitCount = 0;
  let currency: string | null = null;
  let priceable = true;

  if (lines.length > MAX_CART_ITEMS) issues.push({ variantId: null, kind: 'too-many-items' });

  for (const line of lines) {
    if (currency === null) currency = line.currency;
    else if (currency !== line.currency) {
      issues.push({ variantId: line.variantId, kind: 'currency-mismatch' });
      priceable = false;
    }

    if (!line.sellable) issues.push({ variantId: line.variantId, kind: 'not-sellable' });

    try {
      assertCartQuantity(line.quantity);
    } catch {
      issues.push({ variantId: line.variantId, kind: 'quantity-invalid' });
      priceable = false;
      continue;
    }
    unitCount += line.quantity;

    if (line.availableToPromise < line.quantity) {
      issues.push({ variantId: line.variantId, kind: 'insufficient-stock' });
    }

    let unit: bigint;
    try {
      unit = parseMinorUnits(line.unitPriceMinor);
    } catch {
      issues.push({ variantId: line.variantId, kind: 'price-invalid' });
      priceable = false;
      continue;
    }
    if (unit <= 0n) {
      issues.push({ variantId: line.variantId, kind: 'price-invalid' });
      priceable = false;
      continue;
    }

    const expected = unit * BigInt(line.quantity);
    subtotal += expected;

    // A server total that disagrees is surfaced, not trusted and not hidden.
    try {
      if (parseMinorUnits(line.lineTotalMinor) !== expected) {
        issues.push({ variantId: line.variantId, kind: 'line-total-mismatch' });
      }
    } catch {
      issues.push({ variantId: line.variantId, kind: 'line-total-mismatch' });
    }
  }

  const empty = lines.length === 0;
  return {
    lineCount: lines.length,
    unitCount,
    subtotalMinor: empty || !priceable ? null : subtotal,
    currency: empty ? null : currency,
    issues,
    readyForCheckout: !empty && issues.length === 0,
  };
}

export const CART_ISSUE_MESSAGES: Record<CartIssueKind, string> = {
  'not-sellable': 'This item is no longer available for sale. Remove it to continue.',
  'insufficient-stock': 'Requested quantity is no longer in stock. Reduce the quantity.',
  'quantity-invalid': `Quantity must be between 1 and ${MAX_CART_LINE_QUANTITY}.`,
  'price-invalid': 'This item has no valid price right now.',
  'line-total-mismatch': 'The price changed while you were shopping. Refresh to see the current price.',
  'currency-mismatch': 'Items in different currencies cannot be ordered together.',
  'too-many-items': `A cart can hold at most ${MAX_CART_ITEMS} different items.`,
};
export type CartMutationOp = 'add' | 'update' | 'remove';

export interface CartMutationValue {
  variantId: string;
  quantity?: number;
  expectedVersion?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a storefront cart mutation before it reaches the API.
 *
 * `add` resolves the cart version server-side, so it must not accept one from the
 * browser. `update`/`remove` must carry the version the buyer actually saw, so a
 * concurrent edit is detected rather than overwritten.
 */
export function parseCartMutation(
  op: CartMutationOp,
  raw: unknown,
): { ok: true; value: CartMutationValue } | { ok: false; code: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, code: 'BODY_INVALID' };
  const body = raw as Record<string, unknown>;
  const variantId = body['variantId'];
  if (typeof variantId !== 'string' || !UUID_RE.test(variantId)) return { ok: false, code: 'VARIANT_ID_INVALID' };

  const value: CartMutationValue = { variantId };
  if (op !== 'remove') {
    const quantity = body['quantity'];
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      return { ok: false, code: 'QUANTITY_INVALID' };
    }
    value.quantity = quantity;
  }
  if (op !== 'add') {
    const version = body['expectedVersion'];
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return { ok: false, code: 'VERSION_INVALID' };
    }
    value.expectedVersion = version;
  }
  return { ok: true, value };
}
