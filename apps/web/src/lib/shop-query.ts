import { buildShopQuery } from '@getstoopy/core';

type SearchValue = string | string[] | undefined;
export type ShopInput = Record<string, SearchValue>;
export type ShopQueryIssue = 'search-too-long' | 'invalid-category' | 'invalid-cursor';

function first(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The displayed filters must match the values sent by the catalog query builder. */
export function normalizeShopQuery(raw: ShopInput): {
  q: string | undefined;
  categoryId: string | undefined;
  cursor: string | undefined;
  issues: ShopQueryIssue[];
} {
  const q = first(raw['q']);
  const categoryId = first(raw['categoryId']);
  const cursor = first(raw['cursor']);
  const params = buildShopQuery({ q, categoryId, cursor });
  const issues: ShopQueryIssue[] = [];
  if (q && q.trim().length > 120) issues.push('search-too-long');
  if (categoryId && !params.has('categoryId')) issues.push('invalid-category');
  if (cursor && !params.has('cursor')) issues.push('invalid-cursor');
  return { q: params.get('q') ?? undefined, categoryId: params.get('categoryId') ?? undefined, cursor: params.get('cursor') ?? undefined, issues };
}

/** Avoid linking to a malformed cursor that the request layer would silently drop. */
export function isValidShopCursor(cursor: unknown): cursor is string {
  return typeof cursor === 'string' && buildShopQuery({ cursor }).has('cursor');
}
