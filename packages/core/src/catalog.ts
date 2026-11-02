export type StoreStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED';
export type ProductStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export const storeTransitions: Record<StoreStatus, StoreStatus[]> = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE']
};

export function assertStoreTransition(from: StoreStatus, to: StoreStatus): void {
  if (!(storeTransitions[from] ?? []).includes(to)) throw new Error(`STORE_INVALID_TRANSITION_${from}_${to}`);
}

/** Draft-only catalog foundation. Publication/moderation is a later gated slice. */
export const productDraftTransitions: Record<ProductStatus, ProductStatus[]> = {
  DRAFT: ['ARCHIVED'],
  PUBLISHED: ['ARCHIVED'],
  ARCHIVED: []
};

export function assertProductDraftTransition(from: ProductStatus, to: ProductStatus): void {
  if (to === 'PUBLISHED') throw new Error('PRODUCT_PUBLICATION_NOT_ENABLED');
  if (!(productDraftTransitions[from] ?? []).includes(to)) throw new Error(`PRODUCT_INVALID_TRANSITION_${from}_${to}`);
}

export const MAX_PRICE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

export function parsePriceMinor(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('PRICE_MINOR_INVALID');
  const amount = BigInt(value);
  if (amount <= 0n || amount > MAX_PRICE_MINOR) throw new Error('PRICE_MINOR_INVALID');
  return amount;
}

export function assertVariantPrice(priceAmountMinor: bigint, compareAtAmountMinor: bigint | null, currency: string, expectedCurrency: string): void {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('INVALID_CURRENCY');
  if (currency !== expectedCurrency) throw new Error('CURRENCY_MISMATCH');
  if (priceAmountMinor <= 0n || priceAmountMinor > MAX_PRICE_MINOR) throw new Error('PRICE_MINOR_INVALID');
  if (compareAtAmountMinor !== null && (compareAtAmountMinor < priceAmountMinor || compareAtAmountMinor > MAX_PRICE_MINOR)) throw new Error('COMPARE_AT_PRICE_INVALID');
}
