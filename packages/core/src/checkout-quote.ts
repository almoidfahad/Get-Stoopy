/**
 * Checkout quote presentation and request validation, shared by the storefront
 * and tests.
 *
 * Two rules drive this module.
 *
 * First, **never invent a total**. The quote API currently returns
 * `deliveryFeeMinor: null`, `totalMinor: null` and `paymentStatus:
 * 'NOT_IMPLEMENTED'`. A checkout screen that quietly rendered the subtotal as the
 * grand total would be lying to the buyer, so the summary exposes
 * `totalsImplemented` and `paymentImplemented` and the UI must label the missing
 * numbers instead of substituting them.
 *
 * Second, **re-derive what the buyer is asked to trust**. The server sends line
 * totals, group subtotals and a quote subtotal; this recomputes them with bigint
 * arithmetic and flags any disagreement rather than picking a side, because a
 * mismatch means a price moved while the quote was open.
 */
import { parseMinorUnits } from './catalog-display.js';

export const QUOTE_STATES = ['RESERVED', 'RELEASED', 'EXPIRED', 'CONSUMED'] as const;
export type QuoteState = (typeof QUOTE_STATES)[number];

export interface QuoteItemInput {
  readonly itemId: string;
  readonly groupId: string;
  readonly variantId: string;
  readonly productTitle: string;
  readonly quantity: number;
  readonly unitPriceMinor: string;
  readonly lineTotalMinor: string;
  readonly currency: string;
}

export interface QuoteGroupInput {
  readonly groupId: string;
  readonly storeId: string;
  readonly subtotalMinor: string;
  readonly currency: string;
}

export interface QuoteInput {
  readonly quoteId: string;
  readonly cartId: string;
  readonly currency: string;
  readonly state: string;
  readonly destinationCityId: string;
  readonly subtotalMinor: string;
  readonly version: number;
  readonly expiresAt: string;
  readonly closedAt: string | null;
  readonly deliveryFeeMinor: string | null;
  readonly totalMinor: string | null;
  readonly paymentStatus: string;
  readonly groups: readonly QuoteGroupInput[];
  readonly items: readonly QuoteItemInput[];
}

export type QuoteStatus = 'reserved' | 'expired' | 'released' | 'consumed' | 'unknown';

export type QuoteIssueKind =
  | 'price-invalid'
  | 'line-total-mismatch'
  | 'group-subtotal-mismatch'
  | 'subtotal-mismatch'
  | 'currency-mismatch';

export interface QuoteIssue {
  readonly kind: QuoteIssueKind;
  readonly itemId: string | null;
}

export interface QuoteSummary {
  readonly status: QuoteStatus;
  /** Whole seconds until expiry, floored at 0. Never negative. */
  readonly secondsRemaining: number;
  readonly lineCount: number;
  readonly unitCount: number;
  readonly storeCount: number;
  /** null when any price is unparseable or currencies are mixed. */
  readonly subtotalMinor: bigint | null;
  readonly currency: string | null;
  /**
   * True only when the API actually returned both delivery and total. While the
   * backend leaves them null this is false and the UI must say "not implemented".
   */
  readonly totalsImplemented: boolean;
  readonly paymentImplemented: boolean;
  /**
   * Releasing is offered whenever the server still considers the quote RESERVED,
   * including an expired one that has not been swept yet: releasing it returns
   * stock to other buyers, which is the useful thing to do.
   */
  readonly canRelease: boolean;
  readonly issues: readonly QuoteIssue[];
}

function statusOf(state: string, expiresAt: number, now: number): QuoteStatus {
  if (state === 'RELEASED') return 'released';
  if (state === 'CONSUMED') return 'consumed';
  if (state === 'EXPIRED') return 'expired';
  if (state !== 'RESERVED') return 'unknown';
  // A RESERVED row past its deadline is expired for the buyer even before the
  // sweeper updates the column.
  return Number.isFinite(expiresAt) && expiresAt <= now ? 'expired' : 'reserved';
}

export function summarizeQuote(quote: QuoteInput, now: Date = new Date()): QuoteSummary {
  const issues: QuoteIssue[] = [];
  const expiresAt = Date.parse(quote.expiresAt);
  const status = statusOf(quote.state, expiresAt, now.getTime());
  const secondsRemaining = Number.isFinite(expiresAt)
    ? Math.max(0, Math.floor((expiresAt - now.getTime()) / 1000))
    : 0;

  let subtotal = 0n;
  let priceable = true;
  let currency: string | null = quote.currency;
  const groupTotals = new Map<string, bigint>();

  for (const item of quote.items) {
    if (item.currency !== quote.currency) {
      issues.push({ kind: 'currency-mismatch', itemId: item.itemId });
      currency = null;
    }
    try {
      const unit = parseMinorUnits(item.unitPriceMinor);
      const line = parseMinorUnits(item.lineTotalMinor);
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        issues.push({ kind: 'price-invalid', itemId: item.itemId });
        priceable = false;
        continue;
      }
      const expected = unit * BigInt(item.quantity);
      if (expected !== line) issues.push({ kind: 'line-total-mismatch', itemId: item.itemId });
      subtotal += line;
      groupTotals.set(item.groupId, (groupTotals.get(item.groupId) ?? 0n) + line);
    } catch {
      issues.push({ kind: 'price-invalid', itemId: item.itemId });
      priceable = false;
    }
  }

  for (const group of quote.groups) {
    if (group.currency !== quote.currency) {
      issues.push({ kind: 'currency-mismatch', itemId: null });
      currency = null;
    }
    try {
      if (parseMinorUnits(group.subtotalMinor) !== (groupTotals.get(group.groupId) ?? 0n)) {
        issues.push({ kind: 'group-subtotal-mismatch', itemId: null });
      }
    } catch {
      issues.push({ kind: 'price-invalid', itemId: null });
      priceable = false;
    }
  }

  try {
    if (parseMinorUnits(quote.subtotalMinor) !== subtotal) {
      issues.push({ kind: 'subtotal-mismatch', itemId: null });
    }
  } catch {
    issues.push({ kind: 'price-invalid', itemId: null });
    priceable = false;
  }

  const mixed = currency === null;
  return {
    status,
    secondsRemaining,
    lineCount: quote.items.length,
    unitCount: quote.items.reduce((total, item) => total + (Number.isInteger(item.quantity) ? item.quantity : 0), 0),
    storeCount: new Set(quote.groups.map(group => group.storeId)).size,
    subtotalMinor: priceable && !mixed && quote.items.length > 0 ? subtotal : null,
    currency: mixed ? null : currency,
    totalsImplemented: quote.deliveryFeeMinor !== null && quote.totalMinor !== null,
    paymentImplemented: quote.paymentStatus !== 'NOT_IMPLEMENTED',
    canRelease: quote.state === 'RESERVED',
    issues,
  };
}

export const QUOTE_ISSUE_MESSAGES: Record<QuoteIssueKind, string> = {
  'price-invalid': 'A price in this quote could not be read. Release it and request a new one.',
  'line-total-mismatch': 'A line total no longer matches its unit price. Release this quote and request a new one.',
  'group-subtotal-mismatch': 'A store subtotal no longer matches its items. Release this quote and request a new one.',
  'subtotal-mismatch': 'The quote subtotal no longer matches its items. Release this quote and request a new one.',
  'currency-mismatch': 'This quote mixes currencies, so no total can be shown.',
};

/** Buyer-facing copy for the codes the quote endpoints actually return. */
export const QUOTE_ERROR_MESSAGES: Record<string, string> = {
  SIGN_IN_REQUIRED: 'Please sign in to continue to checkout.',
  MARKET_NOT_CONFIGURED: 'This deployment has no market configured yet.',
  CART_EMPTY: 'Your cart is empty, so there is nothing to quote.',
  CART_ITEM_LIMIT: 'Your cart holds too many different items to quote at once.',
  CHECKOUT_CART_VERSION_CONFLICT: 'Your cart changed in another tab. The page has been refreshed — please try again.',
  CHECKOUT_QUOTE_VERSION_CONFLICT: 'This quote changed in another tab. The page has been refreshed.',
  CHECKOUT_QUOTE_ALREADY_RESERVED: 'You already have an active quote for this cart. Release it before requesting another.',
  CHECKOUT_ACTIVE_QUOTE_LIMIT: 'You have too many active quotes. Release one before requesting another.',
  CHECKOUT_IDEMPOTENCY_CONFLICT: 'That request was already used for a different quote. Request a new quote.',
  CHECKOUT_DESTINATION_NOT_SERVICEABLE: 'One or more stores in your cart cannot deliver to that city. Choose another city.',
  CHECKOUT_QUOTE_NOT_FOUND: 'That quote no longer exists. Request a new one.',
  DESTINATION_INVALID: 'Choose a delivery city from the list.',
  VERSION_INVALID: 'The quote version was missing or invalid. Reload the page and try again.',
  QUOTE_UNAVAILABLE: 'The checkout service could not be reached. Please try again shortly.',
  SERVICEABILITY_UNAVAILABLE: 'The list of delivery cities could not be loaded. Please try again shortly.',
  ORIGIN_DENIED: 'That request was rejected. Reload the page and try again.',
};

export function quoteErrorMessage(code: string | undefined, status: number): string {
  if (code && QUOTE_ERROR_MESSAGES[code]) return QUOTE_ERROR_MESSAGES[code];
  return status >= 500
    ? 'The checkout service is unavailable. Please try again shortly.'
    : 'That checkout request could not be completed.';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface QuoteCreateValue {
  readonly destinationCityId: string;
  readonly expectedVersion: number;
  /**
   * A client-generated id for this attempt. The server turns it into the API's
   * `commandKey`, so a double-clicked button or a retried request reuses the same
   * key instead of reserving stock twice.
   */
  readonly commandKey: string;
}

export type QuoteParseResult<T> = { ok: true; value: T } | { ok: false; code: string };

/**
 * The browser supplies `attemptId`; the `web-` prefix is added here so a client
 * cannot choose an arbitrary idempotency namespace.
 */
export function parseQuoteCreate(body: unknown): QuoteParseResult<QuoteCreateValue> {
  if (typeof body !== 'object' || body === null) return { ok: false, code: 'BODY_INVALID' };
  const input = body as Record<string, unknown>;
  const city = input['destinationCityId'];
  if (typeof city !== 'string' || !UUID_RE.test(city)) return { ok: false, code: 'DESTINATION_INVALID' };
  const version = input['expectedVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, code: 'VERSION_INVALID' };
  }
  const attempt = input['attemptId'];
  if (typeof attempt !== 'string' || !UUID_RE.test(attempt)) return { ok: false, code: 'ATTEMPT_ID_INVALID' };
  return {
    ok: true,
    value: { destinationCityId: city.toLowerCase(), expectedVersion: version, commandKey: `web-${attempt.toLowerCase()}` },
  };
}

export interface QuoteReleaseValue {
  readonly version: number;
  readonly reason: string;
}

/**
 * The reason is fixed server-side rather than taken from the browser: it lands in
 * the audit log and the inventory movement history, so it must not be
 * client-controlled free text.
 */
export const QUOTE_RELEASE_REASON = 'Buyer released the checkout quote from the web checkout page.';

export function parseQuoteRelease(body: unknown): QuoteParseResult<QuoteReleaseValue> {
  if (typeof body !== 'object' || body === null) return { ok: false, code: 'BODY_INVALID' };
  const version = (body as Record<string, unknown>)['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, code: 'VERSION_INVALID' };
  }
  return { ok: true, value: { version, reason: QUOTE_RELEASE_REASON } };
}
