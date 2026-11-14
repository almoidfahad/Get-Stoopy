/**
 * Unwired policy-amount lookup only, not an authoritative quote. A caller must
 * independently establish the supported destination and correct distance tier;
 * no current service is authorized to use this result for an order or payment.
 */
export type DeliveryPilotArea = 'MYMENSINGH_CITY' | 'PURBADHALA_SADAR';
export type DeliveryDistanceTier = 'NEAR' | 'MEDIUM' | 'FAR';

/**
 * Classify one independently measured road-delivery leg. This does not fetch a
 * route, authenticate its source, choose rider assignments, or price an order.
 * Missing/invalid measurements and distances above 3 km fail closed.
 */
export function draftCodDistanceTier(distanceMeters: number): DeliveryDistanceTier {
  if (!Number.isSafeInteger(distanceMeters) || distanceMeters < 0) throw new Error('DELIVERY_DISTANCE_INVALID');
  if (distanceMeters > 3000) throw new Error('DELIVERY_DISTANCE_OUT_OF_RANGE');
  return distanceMeters <= 1000 ? 'NEAR' : distanceMeters <= 2000 ? 'MEDIUM' : 'FAR';
}

export function draftCodDeliveryFee(area: DeliveryPilotArea, tier: DeliveryDistanceTier): { readonly kind: 'DRAFT_AMOUNT_ONLY'; readonly currency: 'BDT'; readonly feeMinor: bigint } {
  if (area !== 'MYMENSINGH_CITY' && area !== 'PURBADHALA_SADAR') throw new Error('DELIVERY_AREA_INVALID');
  if (tier !== 'NEAR' && tier !== 'MEDIUM' && tier !== 'FAR') throw new Error('DELIVERY_TIER_INVALID');
  // BDT minor units (paisa), not whole taka or rider earnings. Classification,
  // per-order versus per-delivery fees and fee caps beyond these amounts are
  // not decided by this function.
  const feeMinor = area === 'MYMENSINGH_CITY'
    ? (tier === 'NEAR' ? 2000n : tier === 'MEDIUM' ? 3000n : 4000n)
    : (tier === 'NEAR' ? 2000n : tier === 'MEDIUM' ? 2500n : 3000n);
  return { kind: 'DRAFT_AMOUNT_ONLY', currency: 'BDT', feeMinor };
}
