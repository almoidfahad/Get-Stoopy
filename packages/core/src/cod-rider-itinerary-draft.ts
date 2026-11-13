/**
 * Unwired arithmetic for a caller-supplied ordered rider itinerary. This does
 * not request routes, validate route provenance, or authorize checkout.
 */
import { MAX_CART_ITEMS } from './checkout.js';
import { draftCodDistanceTier, type DeliveryDistanceTier } from './cod-delivery-fee-draft.js';

export interface DraftItineraryLeg {
  readonly fromId: string;
  readonly toId: string;
  readonly distanceMeters: number;
}

/** First store -> subsequent stores -> recipient. A rider's approach to the
 * first store is excluded. Each supplied leg must exactly match that order;
 * summing separate store-to-recipient matrix values is not a rider itinerary.
 */
export function draftRiderItineraryDistance(input: {
  readonly storeIds: readonly string[];
  readonly destinationId: string;
  readonly legs: readonly DraftItineraryLeg[];
}): { readonly kind: 'DRAFT_DISTANCE_ONLY'; readonly distanceMeters: number; readonly tier: DeliveryDistanceTier } {
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9_-]{1,128}$/.test(id);
  if (!input || typeof input !== 'object' || !Array.isArray(input.storeIds) || input.storeIds.length < 1 || input.storeIds.length > MAX_CART_ITEMS) throw new Error('ITINERARY_STORES_INVALID');
  if (!validId(input.destinationId)) throw new Error('ITINERARY_DESTINATION_INVALID');
  const seen = new Set<string>();
  for (const id of input.storeIds) {
    if (!validId(id)) throw new Error('ITINERARY_STORE_ID_INVALID');
    if (seen.has(id)) throw new Error('ITINERARY_STORE_DUPLICATE');
    seen.add(id);
  }
  if (seen.has(input.destinationId)) throw new Error('ITINERARY_DESTINATION_INVALID');
  if (!Array.isArray(input.legs) || input.legs.length !== input.storeIds.length) throw new Error('ITINERARY_LEGS_INVALID');
  let total = 0;
  for (let i = 0; i < input.legs.length; i++) {
    const leg = input.legs[i];
    const from = input.storeIds[i];
    const to = i + 1 < input.storeIds.length ? input.storeIds[i + 1] : input.destinationId;
    if (!leg || typeof leg !== 'object' || leg.fromId !== from || leg.toId !== to) throw new Error('ITINERARY_LEG_SEQUENCE_INVALID');
    if (!Number.isSafeInteger(leg.distanceMeters) || leg.distanceMeters < 0) throw new Error('DELIVERY_DISTANCE_INVALID');
    // Avoid unsafe addition even with maliciously large individual distances.
    if (leg.distanceMeters > 3000 - total) throw new Error('DELIVERY_DISTANCE_OUT_OF_RANGE');
    total += leg.distanceMeters;
  }
  return { kind: 'DRAFT_DISTANCE_ONLY', distanceMeters: total, tier: draftCodDistanceTier(total) };
}
