# Serviceable destination lookup, and the checkout destination gap it closed

Status: **implemented and verified.** Backend slice that unblocks the checkout UI.

## The gap

`POST /commerce/carts/:cartId/quotes` validated `destinationCityId` only as a UUID. It never
checked that the city exists, is active, belongs to the cart's country, or is actually served by
the stores in the cart.

The consequence was concrete: a signed-in buyer could submit **any** well-formed UUID and the
service would proceed to **reserve real inventory** against it — for a non-existent city, an
inactive city, a city in another country, or a city none of the cart's stores can deliver to.
Reservations hold stock away from other buyers until they expire, so this was both a correctness
and an availability problem, not a cosmetic validation miss.

There was also no buyer-facing way to discover a valid destination: `public/catalog` was the only
public controller, so the checkout UI had nothing legitimate to put in a city picker.

## What was added

### One shared definition of a serviceable store

`apps/api/src/serviceability/serviceable-store.ts` exports `serviceableStoreWhere(countryId, now)`.
A store qualifies only when **all** of these hold:

- the store is `ACTIVE` and belongs to the requested country
- the country and the store's city are `ACTIVE`
- the vendor is `ACTIVE` and holds an `APPROVED`, unexpired `VENDOR` KYC case
- the store has an `APPROVED` service area in an `ACTIVE` service zone

This predicate is deliberately shared by the public lookup and by checkout. If the two
disagreed, the storefront could offer a destination that checkout rejects — or checkout could
reserve stock for a destination the public API says is unserved.

Service zones belong to the store's own city (already enforced when a service area is proposed),
so coverage is hyperlocal. This slice enforces the existing model; it does not invent a
cross-city or cross-border policy.

### `GET /public/serviceability/cities?countryId=&q=`

Session-free and read-only, so a buyer can choose a destination before signing in. Returns:

```
{ countryId, currency, items: [{ cityId, name, code, storeCount }], truncated }
```

- Only city id/name/code and an **aggregate** store count. No store, vendor or rider identity.
- Aggregated with `groupBy` so a large store table is never materialised in the API process.
- Capped at 200 cities with an explicit `truncated` flag rather than silently dropping rows.
- Optional `q` name filter, rejected above 60 characters; `countryId` must be a UUID; an unknown
  or inactive country returns `404 COUNTRY_NOT_AVAILABLE`.
- The global throttler still applies.

### Checkout now validates the destination before reserving anything

In `createQuote`, after the cart is locked and before the reservation loop, every distinct store
in the cart must match `serviceableStoreWhere(cart.countryId, now)` **and** have
`cityId === destinationCityId`. Otherwise the request fails with
`409 CHECKOUT_DESTINATION_NOT_SERVICEABLE`.

The check is placed before any reservation so a rejected attempt has **no side effects** — a test
asserts both the quote count and the active-reservation count are unchanged across a rejection.

## Test fixtures corrected, not weakened

Adding the check broke four existing suites, because their store fixtures had no approved
coverage — they had been relying on the missing validation. The fix was to complete the fixtures,
not to relax the rule.

`tests/integration/helpers.ts` gained `approveStoreCoverage`, which creates an `ACTIVE` zone and
approves a service area **through the API with a separate reviewer**. Inserting an `APPROVED` row
directly was rejected as an approach: the service forbids self-review, so a direct insert would
have tested nothing. Applied to the `payments`, `fulfillment` and `risk-producers` fixtures;
`commerce` sets up its own zone inline.

Two mistakes made while writing the new tests are worth recording, because both produced
false failures rather than real ones:

1. Counting reservations by `variantId` globally counted other suites' reservations. Reservations
   hang off `Inventory`, not the variant directly, and the assertion had to become a
   before/after comparison.
2. Counting quotes by `cartId` assumed a fresh cart. The cart is unique per `(user, country)`, so
   `POST /commerce/carts` returns the **existing** cart with its earlier quotes. That assertion
   also became before/after.

The public-lookup suite additionally had to state its own precondition: the dispatch test above
it leaves the service area `SUSPENDED`, and the endpoint correctly excluded the city until the
suite re-approved coverage. `AreaStatus` has no `SUSPENDED` member — zone deactivation uses
`INACTIVE`.

## Verification

| Gate | Result |
| --- | --- |
| `db:validate` | PASS |
| `typecheck` | PASS |
| unit | **248 tests / 42 files** PASS |
| integration | **157 tests / 26 files** PASS (was 148/26; +9 new) |
| design validator | **10 passed / 0 failed** |
| `build`, `build:vercel` | PASS |

New integration coverage:

- destination that does not exist → 409, and **no quote and no reservation created**
- active city in the same country with no approved coverage → 409
- active city in **another country** → 409
- the covered fixture city still succeeds, and the quote can be released
- public lookup works without a session, returns only the four documented fields, and contains
  neither the store id nor the vendor id
- an active city with no covered store is absent
- name filter matches/misses; over-long `q` → 400
- malformed `countryId` → 400; unknown country → 404
- deactivating the service zone removes the city; restoring it brings the city back

`contracts/openapi.json` is the hand-built Phase-1 **design** contract, not a reflection of
implemented routes, so it was intentionally left unchanged; the new endpoint is documented here
and carries Nest Swagger tags for the runtime spec.

## Boundary

No migration, no schema change, no production or Supabase access. The endpoint is read-only and
the checkout change only *rejects* previously-accepted invalid input. Live payments, payouts and
cross-border remain disabled.

## Next

The checkout UI can now be built honestly: a real city picker from this endpoint, quote creation
with the existing idempotency key, reservation expiry display and release. Delivery fee, tax and
total remain `null`/`NOT_IMPLEMENTED` in the quote response and must stay labelled as such.
## Verification record

Local gates (all required gates green before push):

| Gate | Result |
| --- | --- |
| `db:validate` | pass |
| `typecheck` | pass |
| unit (`npm test`) | 248 tests / 42 files pass |
| integration | 157 tests / 26 files pass |
| design validator | 10 passed / 0 failed |
| `build` (production) | pass |
| `build:vercel` (production) | pass |

The first CI attempt for `00da0bb` (run `41809021119`) failed on an unrelated
intermittent outbox-lease assertion; that is documented in `docs/54` and hardened
in `3e1fb0d`. CI run `41811099903` for `3e1fb0d` is **success**.

### Live HTTP smoke of the new public route

The API was booted against the disposable test database and the route was called
over real HTTP (not only through the in-process test harness):

| Request | Observed |
| --- | --- |
| valid `countryId`, no cookie | `200`, JSON `{countryId,currency,items,truncated}`, **no `Set-Cookie`** |
| `q=Comm` (matching) | `200`, 9 cities, `truncated:false` |
| `q=dha` (non-matching) | `200`, `items:[]` |
| `q` = 61 characters | `400 QUERY_INVALID` (`q is too long`) |
| `countryId` not a UUID | `400 BAD_REQUEST` |
| `countryId` omitted | `400 BAD_REQUEST` |
| unknown but well-formed `countryId` | `404 COUNTRY_NOT_AVAILABLE` |

Response bodies were checked to contain **no** `storeId`, `vendorId` or
`serviceAreaId`. Headers (`X-Content-Type-Options: nosniff`, JSON content type, no
`Set-Cookie`, no `Cache-Control`) match the existing public catalog route, so the
two public endpoints behave consistently. The malformed/omitted-UUID messages come
from Nest's `ParseUUIDPipe` and are identical to the catalog route's; they were
left consistent rather than special-cased.

### Deployment posture

Preview-only, as authorised. Production aliases
`get-stoopy.vercel.app` and `getstoopy.vercel.app` were re-checked and both return
**404**; no production target was requested. Preview URLs return `302` to Vercel
SSO, which is expected for this team and is not a build failure — readiness was
confirmed through the deployment API instead.

Previews built from code commit `3e1fb0d`, both `ready_state: READY` and
`target: null` (preview environment, never production):

| Project | Deployment |
| --- | --- |
| `get-stoopy` | `dpl_EBvqqiCYC6toF5sFb6QUEumXEKb1` |
| `getstoopy` | `dpl_4j9U4wjaJG75svWPtxCTa5s667ZY` |

The commit carrying this verification record is documentation-only and changes no
application source, so the previews above still describe the deployed bundle.
