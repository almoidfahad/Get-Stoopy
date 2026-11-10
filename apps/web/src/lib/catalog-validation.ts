import type { ProductPage, PublicCategory, PublicProduct } from './catalog';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const nullableText = (value: unknown) => value === null || typeof value === 'string';
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function uniqueIds(values: readonly unknown[], validate: (value: unknown) => value is { id: string }): boolean {
  const ids = new Set<string>();
  for (const value of values) {
    if (!validate(value)) return false;
    const id = value.id.toLowerCase();
    if (ids.has(id)) return false;
    ids.add(id);
  }
  return true;
}

/** Validate presentation/routing data, not publication, prices or authorization. */
export function isPublicProduct(value: unknown): value is PublicProduct {
  const p = record(value);
  if (!p || !isUuid(p.id) || !text(p.title) || !nullableText(p.description) || !nullableText(p.brand) ||
      typeof p.currency !== 'string' || !nullableText(p.publishedAt) || !Array.isArray(p.variants) || !Array.isArray(p.images)) return false;
  if (p.category !== null) {
    const category = record(p.category);
    if (!category || !isUuid(category.id) || !text(category.name) || typeof category.slug !== 'string') return false;
  }
  if (p.store !== undefined) {
    const store = record(p.store);
    if (!store || !isUuid(store.id) || !text(store.name) || typeof store.slug !== 'string' || !isUuid(store.cityId)) return false;
  }
  const productId = p.id;
  const currency = p.currency;
  if (!uniqueIds(p.variants, (raw): raw is { id: string } => {
    const variant = record(raw);
    if (!variant || !isUuid(variant.id) || (variant.title !== undefined && typeof variant.title !== 'string') ||
        typeof variant.priceAmountMinor !== 'string' || typeof variant.inStock !== 'boolean' ||
        typeof variant.availableToPromise !== 'number' || !Number.isSafeInteger(variant.availableToPromise) || variant.availableToPromise < 0 ||
        variant.inStock !== (variant.availableToPromise > 0)) return false;
    if (variant.productId !== undefined && (!isUuid(variant.productId) || variant.productId.toLowerCase() !== productId.toLowerCase())) return false;
    if (variant.currency !== undefined && (typeof variant.currency !== 'string' || variant.currency !== currency)) return false;
    return true;
  })) return false;
  return uniqueIds(p.images, (raw): raw is { id: string } => {
    const image = record(raw);
    return !!image && isUuid(image.id) && nullableText(image.altText) &&
      typeof image.sortOrder === 'number' && Number.isSafeInteger(image.sortOrder) && image.sortOrder >= 0 &&
      typeof image.contentType === 'string' && typeof image.url === 'string';
  });
}

export function isProductPage(value: unknown): value is ProductPage {
  const page = record(value);
  return !!page && Array.isArray(page.items) && (page.nextCursor === null || typeof page.nextCursor === 'string') && uniqueIds(page.items, isPublicProduct);
}

export function isPublicCategories(value: unknown): value is PublicCategory[] {
  return Array.isArray(value) && uniqueIds(value, (raw): raw is PublicCategory => {
    const category = record(raw);
    return !!category && isUuid(category.id) && (category.parentId === null || isUuid(category.parentId)) &&
      text(category.name) && typeof category.slug === 'string' && nullableText(category.description) &&
      typeof category.sortOrder === 'number' && Number.isSafeInteger(category.sortOrder) && category.sortOrder >= 0;
  });
}
