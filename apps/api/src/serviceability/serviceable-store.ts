import type { Prisma } from '@prisma/client';

/**
 * The single definition of "a store that may fulfil an order right now".
 *
 * This predicate is shared by the public serviceable-city lookup and by checkout
 * quote creation on purpose. If those two disagreed, the storefront could offer a
 * destination that checkout then rejects — or, worse, checkout could reserve stock
 * for a destination the public API says is not served.
 *
 * A store qualifies only when every gate below holds:
 *   - the store is ACTIVE and belongs to the requested country
 *   - the country and the store's city are ACTIVE
 *   - the vendor is ACTIVE and holds an APPROVED, unexpired VENDOR KYC case
 *   - the store has an APPROVED service area in an ACTIVE service zone
 *
 * Service zones belong to the store's own city (enforced when a service area is
 * proposed), so coverage is hyperlocal: a store cannot serve another city, and
 * cross-border is not representable at all.
 */
export function serviceableStoreWhere(countryId: string, now: Date): Prisma.StoreWhereInput {
  return {
    countryId,
    status: 'ACTIVE',
    country: { status: 'ACTIVE' },
    city: { status: 'ACTIVE' },
    vendor: {
      status: 'ACTIVE',
      kycCase: { status: 'APPROVED', subjectType: 'VENDOR', expiresAt: { gt: now } },
    },
    serviceAreas: { some: { status: 'APPROVED', serviceZone: { status: 'ACTIVE' } } },
  };
}

/** Hard safety cap on a public city lookup; not a substitute for search. */
export const MAX_PUBLIC_SERVICEABLE_CITIES = 200;