export type InventoryReservationState = 'ACTIVE' | 'RELEASED' | 'CONSUMED' | 'EXPIRED';
export type InventoryMovementKind = 'ADJUST' | 'RESERVE' | 'RELEASE' | 'CONSUME' | 'EXPIRE';

export const MAX_STOCK_UNITS = 1_000_000;
export const MAX_RESERVATION_QUANTITY = 100;
export const MIN_RESERVATION_TTL_SECONDS = 60;
export const MAX_RESERVATION_TTL_SECONDS = 900;
export const DEFAULT_RESERVATION_TTL_SECONDS = 900;

export function availableToPromise(onHand: number, reserved: number): number {
  assertInventoryBounds(onHand, reserved);
  return onHand - reserved;
}

export function assertInventoryBounds(onHand: number, reserved: number): void {
  if (!Number.isInteger(onHand) || !Number.isInteger(reserved) || onHand < 0 || reserved < 0 || reserved > onHand || onHand > MAX_STOCK_UNITS) {
    throw new Error('INVENTORY_BOUNDS_INVALID');
  }
}

export function assertStockAdjustment(delta: number): void {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_STOCK_UNITS) throw new Error('STOCK_ADJUSTMENT_INVALID');
}

export function assertReservationQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_RESERVATION_QUANTITY) throw new Error('RESERVATION_QUANTITY_INVALID');
}

export function assertReservationTtl(ttlSeconds: number): void {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < MIN_RESERVATION_TTL_SECONDS || ttlSeconds > MAX_RESERVATION_TTL_SECONDS) throw new Error('RESERVATION_TTL_INVALID');
}

export const reservationTransitions: Record<InventoryReservationState, InventoryReservationState[]> = {
  ACTIVE: ['RELEASED', 'CONSUMED', 'EXPIRED'],
  RELEASED: [],
  CONSUMED: [],
  EXPIRED: []
};

export function assertReservationTransition(from: InventoryReservationState, to: InventoryReservationState): void {
  if (!(reservationTransitions[from] ?? []).includes(to)) throw new Error(`RESERVATION_INVALID_TRANSITION_${from}_${to}`);
}

export function assertMovementDeltas(kind: InventoryMovementKind, onHandDelta: number, reservedDelta: number): void {
  if (!Number.isInteger(onHandDelta) || !Number.isInteger(reservedDelta)) throw new Error('MOVEMENT_DELTAS_INVALID');
  switch (kind) {
    case 'ADJUST':
      if (reservedDelta !== 0 || onHandDelta === 0) throw new Error('MOVEMENT_DELTAS_INVALID');
      break;
    case 'RESERVE':
      if (onHandDelta !== 0 || reservedDelta <= 0) throw new Error('MOVEMENT_DELTAS_INVALID');
      break;
    case 'RELEASE':
    case 'EXPIRE':
      if (onHandDelta !== 0 || reservedDelta >= 0) throw new Error('MOVEMENT_DELTAS_INVALID');
      break;
    case 'CONSUME':
      if (onHandDelta !== reservedDelta || onHandDelta >= 0) throw new Error('MOVEMENT_DELTAS_INVALID');
      break;
  }
}
