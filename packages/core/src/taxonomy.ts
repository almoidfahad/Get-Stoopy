export type CategoryStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED';
export type ProductImageStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export const MAX_CATEGORY_DEPTH = 3;
export const MAX_PRODUCT_IMAGES = 8;
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const categoryTransitions: Record<CategoryStatus, CategoryStatus[]> = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE']
};

export function assertCategoryTransition(from: CategoryStatus, to: CategoryStatus): void {
  if (!(categoryTransitions[from] ?? []).includes(to)) throw new Error(`CATEGORY_INVALID_TRANSITION_${from}_${to}`);
}

export function assertCategorySlug(slug: string): void {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 140) throw new Error('CATEGORY_SLUG_INVALID');
}

export function assertCategoryDepth(depth: number): void {
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_CATEGORY_DEPTH) throw new Error('CATEGORY_DEPTH_INVALID');
}

export function assertProductImageAltText(altText: string): void {
  const trimmed = altText.trim();
  if (trimmed.length < 3 || trimmed.length > 180) throw new Error('PRODUCT_IMAGE_ALT_TEXT_INVALID');
}

export function assertProductImageSortOrder(sortOrder: number): void {
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder >= MAX_PRODUCT_IMAGES) throw new Error('PRODUCT_IMAGE_SORT_ORDER_INVALID');
}

export const productImageTransitions: Record<ProductImageStatus, ProductImageStatus[]> = {
  PENDING_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: []
};

export function assertProductImageTransition(from: ProductImageStatus, to: ProductImageStatus): void {
  if (!(productImageTransitions[from] ?? []).includes(to)) throw new Error(`PRODUCT_IMAGE_INVALID_TRANSITION_${from}_${to}`);
}
