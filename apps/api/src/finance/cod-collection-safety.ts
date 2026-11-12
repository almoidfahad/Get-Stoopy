import { ConflictException } from '@nestjs/common';

/**
 * The current COD ledger records the entire order amount per delivery. Until an
 * authoritative per-delivery allocation exists, only an exactly matching
 * single-suborder product-subtotal-only snapshot can use that legacy path.
 * This is an application guard, not a database constraint or readiness signal.
 */
export async function assertLegacyCodCollectionSafe(tx: any, suborder: {
  id: string; orderId: string; currency: string; subtotalMinor: bigint;
  order: { currency: string; amountMinor: bigint; pricingScope: string };
}): Promise<void> {
  const siblings = await tx.vendorSuborder.findMany({ where: { orderId: suborder.orderId }, select: { id: true }, take: 2 });
  if (siblings.length !== 1 || siblings[0]?.id !== suborder.id ||
      suborder.order.pricingScope !== 'PRODUCT_SUBTOTAL_ONLY' ||
      suborder.currency !== suborder.order.currency || suborder.subtotalMinor !== suborder.order.amountMinor) {
    throw new ConflictException({ code: 'COD_ALLOCATION_REQUIRED', message: 'COD delivery allocation is not available for this order' });
  }
}
