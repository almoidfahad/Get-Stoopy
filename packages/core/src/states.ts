export const suborderTransitions: Record<string, string[]> = {
  PENDING_VENDOR: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['FULFILLING', 'CANCELLED'],
  FULFILLING: ['DELIVERED', 'EXCEPTION'],
  DELIVERED: ['COMPLETED', 'RETURN_REQUESTED'],
  COMPLETED: ['RETURN_REQUESTED'],
  EXCEPTION: ['FULFILLING', 'CANCELLED'],
  RETURN_REQUESTED: ['COMPLETED', 'REFUNDED'],
  REJECTED: [], CANCELLED: [], REFUNDED: []
};
export function transition(map: Record<string, string[]>, from: string, to: string): void {
  if (!(map[from] ?? []).includes(to)) throw new Error(`INVALID_TRANSITION_${from}_${to}`);
}
export function manualReady(from: string, actorRole: string, timerExpired: boolean): void {
  if (timerExpired) throw new Error('TIMER_CANNOT_CONFIRM_READY');
  if (actorRole !== 'VENDOR' && actorRole !== 'AUTHORIZED_DISPATCH') throw new Error('READY_ACTOR_DENIED');
  transition(suborderTransitions, from, 'READY_FOR_PICKUP');
}
