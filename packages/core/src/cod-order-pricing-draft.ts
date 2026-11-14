/**
 * Unwired arithmetic validation for explicitly supplied hypothetical pricing.
 * Not a pricing policy, delivery fee selection, quote, or COD authorization.
 */
import { calculatePricingComponents, type PricingCalculation, type PricingGroupComponents } from './checkout-pricing.js';
import type { DeliveryPilotArea } from './cod-delivery-fee-draft.js';

const PURBADHALA_ORDER_DELIVERY_CAP_MINOR = 3000n; // ৳30 in paisa

/**
 * Check already-allocated product and delivery components together. The
 * Purbadhala cap applies to their total customer delivery charge for the whole
 * order, not independently to every store. Nothing here determines whether an
 * area, delivery fee, discount, tax, or allocation is valid or authoritative.
 */
export function validateDraftCodOrderPricing(area: DeliveryPilotArea, groups: readonly PricingGroupComponents[]): {
  readonly kind: 'DRAFT_VALIDATION_ONLY';
  readonly area: DeliveryPilotArea;
  readonly pricing: PricingCalculation;
} {
  if (area !== 'MYMENSINGH_CITY' && area !== 'PURBADHALA_SADAR') throw new Error('DELIVERY_AREA_INVALID');
  const pricing = calculatePricingComponents(groups);
  if (pricing.currency !== 'BDT') throw new Error('COD_PRICING_CURRENCY_INVALID');
  if (area === 'PURBADHALA_SADAR' && pricing.deliveryFeeMinor > PURBADHALA_ORDER_DELIVERY_CAP_MINOR) throw new Error('COD_DELIVERY_ORDER_CAP_EXCEEDED');
  return { kind: 'DRAFT_VALIDATION_ONLY', area, pricing };
}
