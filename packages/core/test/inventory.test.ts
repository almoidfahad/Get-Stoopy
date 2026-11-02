import { describe, expect, it } from 'vitest';
import { assertInventoryBounds, assertMovementDeltas, assertReservationQuantity, assertReservationTransition, assertReservationTtl, assertStockAdjustment, availableToPromise } from '../src/inventory';

describe('inventory and reservation helpers', () => {
  it('computes available-to-promise only for bounded nonnegative stock', () => {
    expect(availableToPromise(10, 3)).toBe(7);
    expect(() => assertInventoryBounds(10, 11)).toThrow('INVENTORY_BOUNDS_INVALID');
    expect(() => assertInventoryBounds(-1, 0)).toThrow('INVENTORY_BOUNDS_INVALID');
    expect(() => assertInventoryBounds(1.5, 0)).toThrow('INVENTORY_BOUNDS_INVALID');
  });
  it('bounds adjustments, reservation quantity and TTL', () => {
    expect(() => assertStockAdjustment(-5)).not.toThrow();
    expect(() => assertStockAdjustment(0)).toThrow('STOCK_ADJUSTMENT_INVALID');
    expect(() => assertReservationQuantity(100)).not.toThrow();
    expect(() => assertReservationQuantity(101)).toThrow('RESERVATION_QUANTITY_INVALID');
    expect(() => assertReservationTtl(900)).not.toThrow();
    expect(() => assertReservationTtl(59)).toThrow('RESERVATION_TTL_INVALID');
    expect(() => assertReservationTtl(901)).toThrow('RESERVATION_TTL_INVALID');
  });
  it('allows only terminal reservation transitions', () => {
    expect(() => assertReservationTransition('ACTIVE', 'RELEASED')).not.toThrow();
    expect(() => assertReservationTransition('ACTIVE', 'CONSUMED')).not.toThrow();
    expect(() => assertReservationTransition('ACTIVE', 'EXPIRED')).not.toThrow();
    expect(() => assertReservationTransition('CONSUMED', 'ACTIVE')).toThrow('RESERVATION_INVALID_TRANSITION');
    expect(() => assertReservationTransition('EXPIRED', 'RELEASED')).toThrow('RESERVATION_INVALID_TRANSITION');
  });
  it('enforces movement delta semantics', () => {
    expect(() => assertMovementDeltas('ADJUST', 5, 0)).not.toThrow();
    expect(() => assertMovementDeltas('RESERVE', 0, 3)).not.toThrow();
    expect(() => assertMovementDeltas('RELEASE', 0, -3)).not.toThrow();
    expect(() => assertMovementDeltas('CONSUME', -3, -3)).not.toThrow();
    expect(() => assertMovementDeltas('CONSUME', -3, 0)).toThrow('MOVEMENT_DELTAS_INVALID');
    expect(() => assertMovementDeltas('RESERVE', -1, 1)).toThrow('MOVEMENT_DELTAS_INVALID');
  });
});
