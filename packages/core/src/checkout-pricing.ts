/**
 * Arithmetic-only checkout pricing building block. This is NOT a pricing
 * policy, a quote, or an authorization to accept payment. Callers must obtain
 * each component from independently approved authoritative sources; none are
 * defaulted to zero. This is not connected to the checkout API.
 */
import { MAX_CART_ITEMS, MAX_CHECKOUT_SUBTOTAL_MINOR } from './checkout.js';

export interface PricingGroupComponents {
  readonly groupId: string;
  readonly currency: string;
  readonly productSubtotalMinor: bigint;
  /** Product-only discount, already allocated to this group by a policy. */
  readonly productDiscountMinor: bigint;
  /** Customer delivery fee, already allocated to this group by a policy. */
  readonly deliveryFeeMinor: bigint;
  /** Tax, already calculated and allocated by an approved policy. */
  readonly taxMinor: bigint;
}

export interface PricingGroupCalculation extends PricingGroupComponents {
  readonly totalMinor: bigint;
}

export interface PricingCalculation {
  readonly kind: 'ARITHMETIC_ONLY';
  readonly currency: string;
  readonly groups: readonly PricingGroupCalculation[];
  readonly productSubtotalMinor: bigint;
  readonly productDiscountMinor: bigint;
  readonly deliveryFeeMinor: bigint;
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
}

function money(value: unknown): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > MAX_CHECKOUT_SUBTOTAL_MINOR) throw new Error('PRICING_COMPONENT_INVALID');
  return value;
}
function add(a: bigint, b: bigint): bigint {
  const sum = a + b;
  if (sum > MAX_CHECKOUT_SUBTOTAL_MINOR) throw new Error('PRICING_AMOUNT_LIMIT');
  return sum;
}

/**
 * Sum already-priced store groups in PostgreSQL BIGINT minor units. The caller
 * must separately validate cart, destination, policies, currency and snapshots.
 * Results are deliberately not directly usable as a checkout quote.
 */
export function calculatePricingComponents(groups: readonly PricingGroupComponents[]): PricingCalculation {
  if (!Array.isArray(groups) || groups.length === 0 || groups.length > MAX_CART_ITEMS) throw new Error('PRICING_GROUP_COUNT_INVALID');
  const seen = new Set<string>();
  const result: PricingGroupCalculation[] = [];
  let currency: string | undefined;
  let subtotal = 0n, discount = 0n, delivery = 0n, tax = 0n, total = 0n;
  for (const group of groups) {
    if (!group || typeof group !== 'object' || typeof group.groupId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(group.groupId)) throw new Error('PRICING_GROUP_INVALID');
    if (seen.has(group.groupId)) throw new Error('PRICING_GROUP_DUPLICATE');
    seen.add(group.groupId);
    if (typeof group.currency !== 'string' || !/^[A-Z]{3}$/.test(group.currency)) throw new Error('PRICING_CURRENCY_INVALID');
    if (currency !== undefined && currency !== group.currency) throw new Error('PRICING_CURRENCY_MISMATCH');
    currency = group.currency;
    const groupSubtotal = money(group.productSubtotalMinor);
    const groupDiscount = money(group.productDiscountMinor);
    const groupDelivery = money(group.deliveryFeeMinor);
    const groupTax = money(group.taxMinor);
    if (groupSubtotal === 0n || groupDiscount > groupSubtotal) throw new Error('PRICING_DISCOUNT_OR_SUBTOTAL_INVALID');
    const groupTotal = add(add(groupSubtotal - groupDiscount, groupDelivery), groupTax);
    subtotal = add(subtotal, groupSubtotal);
    discount = add(discount, groupDiscount);
    delivery = add(delivery, groupDelivery);
    tax = add(tax, groupTax);
    total = add(total, groupTotal);
    result.push({ groupId: group.groupId, currency: group.currency, productSubtotalMinor: groupSubtotal, productDiscountMinor: groupDiscount, deliveryFeeMinor: groupDelivery, taxMinor: groupTax, totalMinor: groupTotal });
  }
  result.sort((a, b) => a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0);
  return { kind: 'ARITHMETIC_ONLY', currency: currency!, groups: result, productSubtotalMinor: subtotal, productDiscountMinor: discount, deliveryFeeMinor: delivery, taxMinor: tax, totalMinor: total };
}
