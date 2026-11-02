# Atomic dispatch offer/assignment foundation

Last updated: 2026-11-02.

Status: **implemented and locally integration-tested development slice**. This is the dispatch/assignment prerequisite for pickup/OTP delivery proof and rider finance. It is **not** live paid routing, OTP proof, delivery completion, cancellation/restock/refund, earnings/COD liability, settlement/payout or production readiness.

## 1. Scope

This slice adds:

- Buyer-set immutable order delivery destination snapshot (zone + approved boundary version + point + address line).
- One dispatch run per manually-ready, payment-eligible vendor suborder.
- Fail-closed store/destination/pickup-zone serviceability checks.
- Candidate filtering by active KYC, active consented shift, fresh accurate location, pickup+destination zone grants and available rider capacity.
- Road-route matrix adapter boundary with a Google Routes adapter and a disabled default.
- Stable candidate ranking: configured priority → road pickup distance → oldest-offer fairness → rider ID.
- One open **30-second** offer per dispatch run, using database time.
- Atomic rider acceptance creating exactly one active assignment per rider and per suborder.
- Offer reject/timeout escalation back to `SEARCHING` or into `MANUAL_REVIEW`.
- Append-only dispatch events, audit and outbox.
- Bounded privileged worker expiry wake.

## 2. Migrations and schema

Applied only to isolated local test DB `getstoopy_foundation_test`:

| Migration | Purpose |
|---|---|
| `0029_atomic_dispatch_foundation` | Destination snapshot, dispatch run/offer/assignment/event tables, PostGIS points/GiST, guards, RLS, candidate/eligibility helpers and DB-time expiry function. |
| `0030_dispatch_expiry_lock_order` | Additive `CREATE OR REPLACE FUNCTION` so expiry locks run before offer, matching acceptance lock order. |

New models:

- `OrderDeliveryDestination`
- `DispatchRun`
- `DispatchOffer`
- `RiderAssignment`
- `DispatchEvent`

Important database invariants:

- Destination is immutable once set; point must be covered by an approved effective zone boundary.
- Dispatch run requires `READY_FOR_PICKUP`, verified/COD payment, serviceable store, approved destination service area and exactly one approved pickup zone in the store city.
- Offer TTL is exactly 30 seconds; one open offer and one accepted offer per run.
- Assignment requires an accepted, unexpired offer and copies the road-route snapshot.
- One active assignment per rider and per suborder (partial unique indexes).
- Dispatch events are append-only.
- Runtime role has SELECT only through RLS; writes are privileged and guarded.

## 3. Road routing

`ROAD_ROUTING_ENABLED=false` by default. Live paid routing is **not authorized** and production config rejects enablement.

- `RoadRouteMatrixPort` is the adapter boundary.
- `DisabledRoadRouteMatrix` fails closed.
- `GoogleRoutesRoadRouteMatrix` calls Google Routes `distanceMatrix/v2:computeRouteMatrix` with a field mask and timeout.
- Integration tests use a local HTTP stub in `NODE_ENV=test`; no paid Google call is made.
- There is **no straight-line fallback**. Missing/incomplete road-route evidence blocks offer creation.

Offer/assignment snapshots store provider, mode, pickup distance, store→destination road distance, duration and evidence hash. Rate/earnings snapshots are still pending.

## 4. HTTP surface

All routes are under `/api/v1`, require session auth, and mutations require Origin + CSRF.

| Method | Path | Authority | Notes |
|---|---|---|---|
| POST | `/orders/:orderId/delivery-destination` | buyer | Immutable destination inside approved boundary. |
| POST | `/admin/dispatch/suborders/:suborderId/runs` | `dispatch:run:manage` + STEP_UP + scope | Create one run per ready suborder. |
| POST | `/admin/dispatch/runs/:runId/next-offer` | `dispatch:run:manage` + STEP_UP + pickup/destination scope | Create next 30-second offer or escalate. |
| GET | `/admin/dispatch/runs/:runId` | same | Run/offers/assignment projection. |
| GET | `/admin/dispatch/runs/:runId/history` | same | Append-only event history. |
| GET | `/admin/dispatch/manual-queue?countryId=...` | same | Manual-review queue. |
| GET | `/riders/me/dispatch-offers` | active KYC rider | Own open offers + offer token. |
| GET | `/riders/me/assignment` | active KYC rider | Own active assignment. |
| POST | `/riders/me/dispatch-offers/:offerId/accept` | offered rider + offer token | Atomic single assignment. |
| POST | `/riders/me/dispatch-offers/:offerId/reject` | offered rider + offer token | Reject and escalate. |

Offer tokens are HMAC-bound to offer ID, stored only as hashes, returned only to the offered rider, and never placed in outbox/audit payloads.

## 5. Worker

`apps/worker/src/dispatch-expiry.ts` calls `gs_expire_dispatch_offers(batch)` through the privileged role. It is disabled by default (`DISPATCH_EXPIRY_ENABLED=false`). Delayed jobs/wakes are not authoritative; database status and `expiresAt` decide. Expiry writes event/audit/outbox atomically and escalates to manual review after max attempts.

## 6. Verification

Local gates against isolated PostgreSQL/PostGIS + Redis:

- `npm test`: unit PASS.
- `npm run test:integration`: integration PASS, including `tests/integration/dispatch.test.ts`.
- `npm run typecheck`: PASS.
- `npm run db:validate`: PASS.
- `npm run build:api`: PASS.
- `npm run build:worker`: PASS.

Dispatch integration covers:

1. Destination boundary validation, ready-suborder gating, road-route-backed offer, token/auth isolation, atomic acceptance and immutable assignment.
2. Concurrent acceptance across two offers: exactly one active assignment; idempotent replay.
3. DB-time expiry, escalation, next offer, reject and append-only history.

## 7. Explicit limitations

- No pickup confirmation, recipient OTP, delivery completion or proof exception.
- No rider earnings/rate snapshot, COD liability/deposit ledger or settlement/payout.
- No cancellation/restock/refund.
- No live Google Routes call, paid resource or production deployment.
- No socket/push notification adapter yet; rider polls own offers.
- Manual dispatch assignment override is not implemented; queue is review-only.
- Location retention/spoof detection remain pending.

## 8. Next dependency

The next safe slice is **pickup/OTP delivery proof and completion gating**, followed by cancellation/restock/refund and then rider earnings/COD liability ledgers. Financial entries must remain immutable and must not be created from dispatch assignment alone.
