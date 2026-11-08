import { formatMinorUnits, parseMinorUnits } from '@getstoopy/core';

/** No fallback currency: incomplete upstream pricing must not become a price. */
export function formatCatalogPrice(value: string, currency: unknown): string | null {
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return null;
  try {
    if (parseMinorUnits(value) <= 0n) return null;
    return formatMinorUnits(value, currency);
  } catch { return null; }
}
