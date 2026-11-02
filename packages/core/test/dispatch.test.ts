import { describe, expect, it } from 'vitest';
import { assertRoadRouteMatrix, dispatchOfferToken, dispatchOfferTokenHash, rankDispatchCandidates, verifyDispatchOfferToken, type DispatchCandidate } from '../src/index.js';

const secret = 'dispatch-offer-token-secret-000000000000';
const candidate = (overrides: Partial<DispatchCandidate>): DispatchCandidate => ({
  riderId: 'rider', shiftId: 'shift', locationSampleId: 'loc', pickupZoneGrantId: 'pg', destinationZoneGrantId: 'dg',
  latitude: 24.75, longitude: 90.4, priority: 0, lastOfferAt: null, vehicleType: 'MOTORBIKE', pickupDistanceMeters: 100, ...overrides
});

describe('atomic dispatch helpers', () => {
  it('binds offer tokens to offer id and compares hashes safely', () => {
    const token = dispatchOfferToken(secret, 'offer-1');
    const hash = dispatchOfferTokenHash(token);
    expect(verifyDispatchOfferToken(secret, 'offer-1', token, hash)).toBe(true);
    expect(verifyDispatchOfferToken(secret, 'offer-2', token, hash)).toBe(false);
    expect(verifyDispatchOfferToken(secret, 'offer-1', '0'.repeat(64), hash)).toBe(false);
    expect(() => dispatchOfferToken('short', 'offer-1')).toThrow('DISPATCH_OFFER_TOKEN_SECRET_REQUIRED');
  });
  it('ranks by priority, road pickup distance, fairness and rider id', () => {
    const a = candidate({ riderId: 'a', priority: 1, pickupDistanceMeters: 500 });
    const b = candidate({ riderId: 'b', priority: 2, pickupDistanceMeters: 900 });
    const c = candidate({ riderId: 'c', priority: 1, pickupDistanceMeters: 100 });
    const d = candidate({ riderId: 'd', priority: 1, pickupDistanceMeters: 100, lastOfferAt: '2026-11-02T08:00:00Z' });
    expect(rankDispatchCandidates([a, b, c, d]).map(x => x.riderId)).toEqual(['b', 'c', 'd', 'a']);
  });
  it('requires complete valid road-route matrix evidence', () => {
    const ok = [{ originIndex: 0, destinationIndex: 0, distanceMeters: 100, durationSeconds: 60, condition: 'ROUTE_EXISTS' }];
    expect(() => assertRoadRouteMatrix(ok, 1, 1)).not.toThrow();
    expect(() => assertRoadRouteMatrix([], 1, 1)).toThrow('ROAD_ROUTE_MATRIX_INCOMPLETE');
    expect(() => assertRoadRouteMatrix([{ ...ok[0]!, condition: 'ROUTE_NOT_FOUND' }], 1, 1)).toThrow('ROAD_ROUTE_NOT_FOUND');
    expect(() => assertRoadRouteMatrix([{ ...ok[0]!, distanceMeters: -1 }], 1, 1)).toThrow('ROAD_ROUTE_DISTANCE_INVALID');
    expect(() => assertRoadRouteMatrix([...ok, ...ok], 1, 1)).toThrow('ROAD_ROUTE_MATRIX_DUPLICATE');
  });
});
