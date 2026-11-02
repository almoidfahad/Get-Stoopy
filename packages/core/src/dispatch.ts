import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const DISPATCH_OFFER_TTL_SECONDS = 30;
export const DISPATCH_MAX_ATTEMPTS_DEFAULT = 5;
export const DISPATCH_MAX_CANDIDATES = 20;

export function assertDispatchCommandKey(key: string): void {
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(key)) throw new Error('DISPATCH_COMMAND_KEY_INVALID');
}

export function dispatchOfferToken(secret: string, offerId: string): string {
  if (secret.length < 32) throw new Error('DISPATCH_OFFER_TOKEN_SECRET_REQUIRED');
  return createHmac('sha256', secret).update(`dispatch-offer:${offerId}`).digest('hex');
}
export function dispatchOfferTokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function verifyDispatchOfferToken(secret: string, offerId: string, token: string, expectedHash: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(token) || !/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(dispatchOfferTokenHash(dispatchOfferToken(secret, offerId)), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  const presented = Buffer.from(dispatchOfferTokenHash(token), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected) && timingSafeEqual(presented, expected);
}

export interface DispatchCandidate {
  riderId: string;
  shiftId: string;
  locationSampleId: string;
  pickupZoneGrantId: string;
  destinationZoneGrantId: string;
  latitude: number;
  longitude: number;
  priority: number;
  lastOfferAt: string | null;
  vehicleType: 'BICYCLE' | 'MOTORBIKE' | 'CAR';
  pickupDistanceMeters: number;
}

/** Stable policy: configured priority, road pickup distance, oldest offer fairness, rider id. */
export function rankDispatchCandidates(candidates: DispatchCandidate[]): DispatchCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.pickupDistanceMeters !== b.pickupDistanceMeters) return a.pickupDistanceMeters - b.pickupDistanceMeters;
    const at = a.lastOfferAt ? Date.parse(a.lastOfferAt) : -Infinity;
    const bt = b.lastOfferAt ? Date.parse(b.lastOfferAt) : -Infinity;
    if (at !== bt) return at - bt;
    return a.riderId.localeCompare(b.riderId);
  });
}

export interface RoadRoutePoint { latitude: number; longitude: number; }
export interface RoadRouteElement { originIndex: number; destinationIndex: number; distanceMeters: number; durationSeconds: number | null; condition: string; }
export function assertRoadRouteMatrix(elements: RoadRouteElement[], originCount: number, destinationCount: number): void {
  if (!Number.isInteger(originCount) || originCount < 1 || originCount > 25 || !Number.isInteger(destinationCount) || destinationCount < 1 || destinationCount > 25) throw new Error('ROAD_ROUTE_MATRIX_SIZE_INVALID');
  const seen = new Set<string>();
  for (const e of elements) {
    if (!Number.isInteger(e.originIndex) || e.originIndex < 0 || e.originIndex >= originCount || !Number.isInteger(e.destinationIndex) || e.destinationIndex < 0 || e.destinationIndex >= destinationCount) throw new Error('ROAD_ROUTE_MATRIX_INDEX_INVALID');
    if (e.condition !== 'ROUTE_EXISTS') throw new Error('ROAD_ROUTE_NOT_FOUND');
    if (!Number.isSafeInteger(e.distanceMeters) || e.distanceMeters < 0 || e.distanceMeters > 2_000_000) throw new Error('ROAD_ROUTE_DISTANCE_INVALID');
    if (e.durationSeconds !== null && (!Number.isSafeInteger(e.durationSeconds) || e.durationSeconds < 0)) throw new Error('ROAD_ROUTE_DURATION_INVALID');
    const key = `${e.originIndex}:${e.destinationIndex}`;
    if (seen.has(key)) throw new Error('ROAD_ROUTE_MATRIX_DUPLICATE');
    seen.add(key);
  }
  if (seen.size !== originCount * destinationCount) throw new Error('ROAD_ROUTE_MATRIX_INCOMPLETE');
}
export function roadRouteEvidenceHash(input: unknown): string { return createHash('sha256').update(JSON.stringify(input)).digest('hex'); }
