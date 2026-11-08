/** Same-origin path only. The proxy validates IDs and serves approved public images. */
export function imageProxyUrl(productId: string, imageId: string): string {
  return `/api/catalog/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}`;
}
