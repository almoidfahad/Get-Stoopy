/**
 * Pure display helpers for the public catalog.
 *
 * Kept in core (not in the web app) so the money and stock rules that a buyer sees
 * are unit-tested like the rest of the domain. Two rules matter for correctness:
 *
 *  1. Prices arrive from the API as **strings of minor units** because they are
 *     Postgres bigints. They must never be passed through a float, and the number
 *     of decimals comes from the currency, not a hardcoded 100.
 *  2. A product with no in-stock variant is not "free" or "0.00" — it has no
 *     displayable price. Callers must handle `null` rather than render a zero.
 */

export interface PublicVariant {
  readonly id: string;
  /** present in the API payload; optional so price math can be tested in isolation */
  readonly title?: string | undefined;
  readonly priceAmountMinor: string;
  readonly compareAtAmountMinor?: string | null;
  readonly availableToPromise: number;
  readonly inStock: boolean;
}

/** Parse an API minor-unit string without ever touching a float. */
export function parseMinorUnits(value: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(value)) throw new Error('MINOR_UNITS_INVALID');
  return BigInt(value);
}

function currencyDecimals(currency: string, locale: string): number {
  const digits = new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits;
  return digits ?? 2;
}

/**
 * Format minor units for display. Returns null for an unparseable value so a bad
 * upstream payload cannot render a misleading price.
 */
export function formatMinorUnits(value: string, currency: string, locale = 'en-US'): string | null {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('INVALID_CURRENCY');
  let minor: bigint;
  try {
    minor = parseMinorUnits(value);
  } catch {
    return null;
  }
  const decimals = currencyDecimals(currency, locale);
  const scale = 10n ** BigInt(decimals);
  const whole = minor / scale;
  const fraction = minor % scale;
  // Intl can format an exact decimal *string* (ES2023). Passing a Number would
  // silently lose precision above 2^53 minor units, and patching the formatted
  // output with a regex breaks in locales that put the symbol after the amount.
  const decimalText =
    decimals === 0 ? whole.toString() : `${whole.toString()}.${fraction.toString().padStart(decimals, '0')}`;
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (formatter as unknown as { format(value: string): string }).format(decimalText);
}

export interface PriceSummary {
  /** null when nothing is priced/displayable */
  readonly lowestMinor: bigint | null;
  readonly highestMinor: bigint | null;
  readonly singlePrice: boolean;
  readonly inStockCount: number;
  readonly anyInStock: boolean;
}

/**
 * Summarise variant prices. Only variants a buyer can actually order (in stock)
 * drive the "from" price, so an out-of-stock cheap variant cannot advertise a
 * price nobody can buy.
 */
export function summarizeVariantPrices(variants: readonly PublicVariant[]): PriceSummary {
  const orderable = variants.filter(v => v.inStock && v.availableToPromise > 0);
  const priced: bigint[] = [];
  for (const variant of orderable) {
    try {
      priced.push(parseMinorUnits(variant.priceAmountMinor));
    } catch {
      // A malformed price is skipped, never coerced to zero.
    }
  }
  if (priced.length === 0) {
    return { lowestMinor: null, highestMinor: null, singlePrice: false, inStockCount: 0, anyInStock: false };
  }
  let lowest = priced[0] as bigint;
  let highest = lowest;
  for (const value of priced) {
    if (value < lowest) lowest = value;
    if (value > highest) highest = value;
  }
  return {
    lowestMinor: lowest,
    highestMinor: highest,
    singlePrice: lowest === highest,
    inStockCount: orderable.length,
    anyInStock: true,
  };
}

export interface ShopQueryInput {
  readonly q?: string | undefined;
  readonly categoryId?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build the public catalog query, dropping anything the API would reject.
 *
 * The page is reachable by anyone editing the URL, so invalid input must degrade
 * to a clean unfiltered listing rather than forwarding a value that produces a
 * 400. Mirrors the API's own limits (q <= 120 chars, limit 1-50, UUID cursor).
 */
export function buildShopQuery(input: ShopQueryInput): URLSearchParams {
  const params = new URLSearchParams();
  const q = input.q?.trim();
  if (q && q.length <= 120) params.set('q', q);
  if (input.categoryId && UUID_RE.test(input.categoryId)) params.set('categoryId', input.categoryId);
  if (input.cursor && UUID_RE.test(input.cursor)) params.set('cursor', input.cursor);
  const limit = input.limit ?? 20;
  params.set('limit', String(Number.isInteger(limit) && limit >= 1 && limit <= 50 ? limit : 20));
  return params;
}