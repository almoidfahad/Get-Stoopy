/**
 * Unwired candidate calculator for the owner's highest-slab-once rule.
 * Inputs must be independently obtained and verified; never use as a quote.
 */
import { MAX_CART_ITEMS } from './checkout.js';
import { draftCodDeliveryFee, draftCodDistanceTier, type DeliveryDistanceTier, type DeliveryPilotArea } from './cod-delivery-fee-draft.js';

export interface DraftRiderDeliveryDistance {
  /** Stable, unique test delivery ID. Not a name or other personal data. */
  readonly deliveryId: string;
  /** Distance for this rider's entire delivery, provided by the caller. */
  readonly distanceMeters: number;
}

export function draftHighestCodDeliveryFee(area: DeliveryPilotArea, deliveries: readonly DraftRiderDeliveryDistance[]): {
  readonly kind: 'DRAFT_AMOUNT_ONLY';
  readonly area: DeliveryPilotArea;
  readonly currency: 'BDT';
  readonly deliveryFeeMinor: bigint;
  readonly deliveries: readonly { readonly deliveryId: string; readonly distanceMeters: number; readonly tier: DeliveryDistanceTier; readonly tierFeeMinor: bigint }[];
} {
  if (area !== 'MYMENSINGH_CITY' && area !== 'PURBADHALA_SADAR') throw new Error('DELIVERY_AREA_INVALID');
  // A temporary defensive bound, not an approved operational rider limit.
  if (!Array.isArray(deliveries) || deliveries.length === 0 || deliveries.length > MAX_CART_ITEMS) throw new Error('DELIVERY_COUNT_INVALID');
  const seen = new Set<string>();
  let highest = 0n;
  const rows = Array.from(deliveries, delivery => {
    if (!delivery || typeof delivery !== 'object' || typeof delivery.deliveryId !== 'string' || !/^[a-z0-9_-]{1,128}$/.test(delivery.deliveryId)) throw new Error('DELIVERY_ID_INVALID');
    if (seen.has(delivery.deliveryId)) throw new Error('DELIVERY_ID_DUPLICATE');
    seen.add(delivery.deliveryId);
    const tier = draftCodDistanceTier(delivery.distanceMeters);
    const fee = draftCodDeliveryFee(area, tier).feeMinor;
    if (fee > highest) highest = fee;
    return { deliveryId: delivery.deliveryId, distanceMeters: delivery.distanceMeters, tier, tierFeeMinor: fee };
  });
  // Defensive invariant on the entire order, not an extra per-delivery fee.
  if (area === 'PURBADHALA_SADAR' && highest > 3000n) throw new Error('COD_DELIVERY_ORDER_CAP_EXCEEDED');
  rows.sort((a, b) => a.deliveryId < b.deliveryId ? -1 : a.deliveryId > b.deliveryId ? 1 : 0);
  return { kind: 'DRAFT_AMOUNT_ONLY', area, currency: 'BDT', deliveryFeeMinor: highest, deliveries: rows };
}
