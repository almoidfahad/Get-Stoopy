import { describe, expect, it } from 'vitest';
import { draftRiderItineraryDistance } from '../src/cod-rider-itinerary-draft';
import { MAX_CART_ITEMS } from '../src/checkout';

const input = () => ({ storeIds: ['shop_a', 'shop_b'], destinationId: 'destination', legs: [
  { fromId: 'shop_a', toId: 'shop_b', distanceMeters: 700 },
  { fromId: 'shop_b', toId: 'destination', distanceMeters: 1300 },
] });

describe('unwired rider itinerary arithmetic', () => {
  it('sums first shop to subsequent shops to recipient, excluding rider approach', () => {
    const itinerary = input();
    expect(draftRiderItineraryDistance(itinerary)).toEqual({ kind: 'DRAFT_DISTANCE_ONLY', distanceMeters: 2000, tier: 'MEDIUM' });
    expect(itinerary.legs[0]!.distanceMeters).toBe(700);
    const single = { storeIds: ['shop_a'], destinationId: 'destination', legs: [{ fromId: 'shop_a', toId: 'destination', distanceMeters: 1000 }] };
    expect(draftRiderItineraryDistance(single)).toEqual({ kind: 'DRAFT_DISTANCE_ONLY', distanceMeters: 1000, tier: 'NEAR' });
  });
  it('applies boundaries to the entire route rather than each leg', () => {
    for (const [total, tier] of [[0, 'NEAR'], [1000, 'NEAR'], [1001, 'MEDIUM'], [2000, 'MEDIUM'], [2001, 'FAR'], [3000, 'FAR']] as const) {
      const itinerary = input(); itinerary.legs[0]!.distanceMeters = Math.floor(total / 2); itinerary.legs[1]!.distanceMeters = total - Math.floor(total / 2);
      expect(draftRiderItineraryDistance(itinerary)).toMatchObject({ distanceMeters: total, tier });
    }
    const tooFar = input(); tooFar.legs[0]!.distanceMeters = 1500; tooFar.legs[1]!.distanceMeters = 1501;
    expect(() => draftRiderItineraryDistance(tooFar)).toThrow('DELIVERY_DISTANCE_OUT_OF_RANGE');
  });
  it('requires contiguous legs in the requested shop order and does not accept independent destination legs', () => {
    const cases = [
      [{ fromId: 'shop_a', toId: 'destination', distanceMeters: 5 }, { fromId: 'shop_b', toId: 'destination', distanceMeters: 5 }],
      [{ fromId: 'shop_b', toId: 'shop_a', distanceMeters: 5 }, { fromId: 'shop_a', toId: 'destination', distanceMeters: 5 }],
      [{ fromId: 'rider_start', toId: 'shop_a', distanceMeters: 5 }, { fromId: 'shop_b', toId: 'destination', distanceMeters: 5 }],
      [{ fromId: 'shop_a', toId: 'shop_b', distanceMeters: 5 }, null],
      new Array(2),
    ];
    for (const legs of cases) expect(() => draftRiderItineraryDistance({ ...input(), legs } as any)).toThrow('ITINERARY_LEG_SEQUENCE_INVALID');
    for (const legs of [[], null, undefined, [...input().legs, input().legs[0]]]) expect(() => draftRiderItineraryDistance({ ...input(), legs } as any)).toThrow('ITINERARY_LEGS_INVALID');
  });
  it('rejects invalid distances and unsafe or excessive sums', () => {
    for (const distanceMeters of [-1, 1.5, NaN, Infinity, null, undefined, '1', Number.MAX_SAFE_INTEGER + 1]) {
      const itinerary = input(); (itinerary.legs[0] as any).distanceMeters = distanceMeters;
      expect(() => draftRiderItineraryDistance(itinerary)).toThrow('DELIVERY_DISTANCE_INVALID');
    }
    for (const distanceMeters of [3001, Number.MAX_SAFE_INTEGER]) {
      const itinerary = input(); itinerary.legs[0]!.distanceMeters = distanceMeters;
      expect(() => draftRiderItineraryDistance(itinerary)).toThrow('DELIVERY_DISTANCE_OUT_OF_RANGE');
    }
  });
  it('requires bounded, distinct store IDs and a distinct destination', () => {
    for (const storeIds of [[], null, undefined, Array.from({ length: MAX_CART_ITEMS + 1 }, (_, i) => `s${i}`)]) expect(() => draftRiderItineraryDistance({ ...input(), storeIds } as any)).toThrow('ITINERARY_STORES_INVALID');
    for (const storeIds of [['shop_a', 'shop_a'], ['shop_b', 'shop_b']]) expect(() => draftRiderItineraryDistance({ ...input(), storeIds })).toThrow('ITINERARY_STORE_DUPLICATE');
    for (const storeIds of [['shop_a', 'private shop'], new Array(1), ['A']]) expect(() => draftRiderItineraryDistance({ ...input(), storeIds })).toThrow('ITINERARY_STORE_ID_INVALID');
    for (const destinationId of ['', 'shop_a', 'Customer Name', null, undefined]) expect(() => draftRiderItineraryDistance({ ...input(), destinationId } as any)).toThrow('ITINERARY_DESTINATION_INVALID');
  });
  it('supports the bounded maximum number of shops', () => {
    const storeIds = Array.from({ length: MAX_CART_ITEMS }, (_, i) => `s${i}`);
    const legs = storeIds.map((id, i) => ({ fromId: id, toId: storeIds[i + 1] ?? 'destination', distanceMeters: 60 }));
    expect(draftRiderItineraryDistance({ storeIds, destinationId: 'destination', legs })).toEqual({ kind: 'DRAFT_DISTANCE_ONLY', distanceMeters: 3000, tier: 'FAR' });
  });
});
