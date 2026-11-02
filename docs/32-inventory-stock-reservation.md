# 32 — Inventory and stock reservation foundation

Status: **Implemented and verified in the isolated development/test database only (2026-11-02).** This slice adds vendor stock balances, append-only stock movements, checkout-facing stock reservations, expiry automation and public availability projection. It does **not** add cart, checkout, orders, payments or delivery. No production database, paid resource, live payment or deployment was touched.

## 1. Scope

Implemented:

- `Inventory`: one balance row per `ProductVariant`, with `onHand`, `reserved`, `reorderLevel`, optimistic `version`, and the invariant `0 <= reserved <= onHand <= 1_000_000`.
- `InventoryMovement`: append-only ledger of every balance/version change (`INITIALIZE` is represented by the empty initial row; `ADJUST`, `RESERVE`, `RELEASE`, `CONSUME`, `EXPIRE` write movements).
- `InventoryReservation`: idempotent per-customer reservation commands, bounded quantity/TTL, explicit terminal states and expiry.
- Vendor HTTP commands for initialize/read/adjust/movement-history.
- Service-only reservation commands (`reserveStock`, `releaseReservation`, `consumeReservation`, `expireDueReservations`) with **no public HTTP route until checkout orchestration exists**.
- Worker expiry tick sharing the same database function as the API service.
- Public catalog variant availability projection (`availableToPromise`, `inStock`) with `Cache-Control: no-store`.
- Additive RLS policy qualification fix for vendor membership reads (`0021`).

Not implemented here:

- Cart/checkout quote orchestration, order creation, payment capture, COD, dispatch, returns/refunds.
- Multi-store inventory transfers, warehouse locations, batch/lot/serial tracking.
- Backorders, preorders, supplier purchasing, automatic reorder procurement.
- Store pickup geometry/hours/service-area approval.

## 2. Migrations

Applied only to `getstoopy_foundation_test`:

- `0020_inventory_reservation_foundation`
  - enums `InventoryMovementKind`, `InventoryReservationState`;
  - tables `Inventory`, `InventoryMovement`, `InventoryReservation`;
  - checks, unique keys, indexes, foreign keys;
  - RLS policies and least-privilege grants;
  - insert/update guards, append-only movement guard, deferred constraint triggers;
  - `gs_expire_inventory_reservations(INTEGER)` shared expiry function.
- `0021_vendor_rls_policy_qualification`
  - `ALTER POLICY vendor_select_owner_member_or_super` to qualify the outer `Vendor.id` in the membership `EXISTS` subquery. The original `0014` policy used an unqualified `"id"` that bound to `VendorMembership.id`, preventing non-owner members from reading their vendor row. This was discovered by the staff inventory-read integration test.

`scripts/db-grants.sql` was re-run after migration. Runtime role has SELECT-only on inventory tables; privileged role has SELECT/INSERT/UPDATE on balances/reservations and SELECT/INSERT-only on movements. DELETE is revoked. No applied migration was edited.

## 3. Invariants and state machines

### Inventory

- Unique `variantId`.
- Must start empty: `onHand = 0`, `reserved = 0`, `version = 1`.
- Bounds: `0 <= reserved <= onHand <= 1_000_000`.
- Initialization requires an active variant, non-archived product, ACTIVE store, and vendor with unexpired APPROVED KYC.
- Adjustments require expected `version`, non-zero delta within bounds, reason, and idempotency `commandKey`.
- Every version change must have exactly one movement; deferred trigger `inventory_movement_required` enforces this at commit.
- `reserved` must equal the sum of ACTIVE reservations; deferred trigger `inventory_reserved_mismatch` enforces this at commit.

### InventoryMovement

- Append-only: UPDATE/DELETE blocked by trigger and grants.
- Unique `(inventoryId, commandKey)` and `(inventoryId, inventoryVersion)`.
- Movement deltas and after-balances must match the current inventory row and reservation state.
- Kinds: `ADJUST`, `RESERVE`, `RELEASE`, `CONSUME`, `EXPIRE`.

### InventoryReservation

- Unique `(userId, commandKey)`; payload hash detects idempotency-key reuse with different input.
- Quantity `1..100`; TTL `60..900` seconds; default TTL 900 seconds.
- States: `ACTIVE -> RELEASED | CONSUMED | EXPIRED` (terminal).
- `CONSUME` is rejected after expiry; `EXPIRE` is rejected before expiry.
- Identity, quantity and expiry are immutable after insert.
- Reservation insert revalidates sellability: active variant, PUBLISHED product, ACTIVE store/country, vendor KYC eligibility, active category chain if assigned, and available-to-promise.
- Row locks serialize concurrent reservations/adjustments; the integration suite proves two concurrent reservations cannot oversell.

### Expiry

- `gs_expire_inventory_reservations(batch)` locks due ACTIVE reservations, decrements `reserved`, writes an `EXPIRE` movement, audit row and outbox event as SYSTEM, and returns the count.
- Worker `runInventoryExpiryTick` is gated by `INVENTORY_EXPIRY_ENABLED` (default `false`) and requires `DATABASE_PRIVILEGED_URL`.
- Batch size is bounded `1..500`; poll interval is configurable.
- Expiry is idempotent: a second tick returns `0` for the same reservations.

## 4. Authorization

- `vendor:inventory:read`: OWNER, MANAGER, STAFF.
- `vendor:inventory:write`: OWNER, MANAGER.
- Vendor membership is resolved only for ACTIVE vendors with unexpired APPROVED KYC and unrevoked/unexpired memberships.
- Country anchor must match; cross-vendor access fails closed (404 for hidden resources, 403 for permission denial).
- Reservation commands are internal service methods; they are not exposed as unauthenticated or customer HTTP endpoints in this slice.
- After vendor KYC revocation, stock writes and new reservations fail closed; public catalog detail returns 404.

## 5. HTTP surface

Base path: `/api/v1/inventory`.

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/variants/:variantId/initialize` | `vendor:inventory:write` | `{ reorderLevel? }`; idempotent empty initialization |
| GET | `/variants/:variantId` | `vendor:inventory:read` | balance + available-to-promise |
| POST | `/variants/:variantId/adjustments` | `vendor:inventory:write` | `{ version, delta, commandKey, reason }` |
| GET | `/variants/:variantId/movements?limit&cursor` | `vendor:inventory:read` | paginated append-only history |

Public catalog product detail/list now include per-variant:

- `availableToPromise = max(0, onHand - reserved)`
- `inStock = onHand > reserved`

These responses remain `Cache-Control: no-store` because availability changes with reservations/expiry.

## 6. Events and audit

Outbox events (schemaVersion 1, country-scoped):

- `inventory.initialized`
- `inventory.adjusted`
- `inventory.reserved`
- `inventory.released`
- `inventory.consumed`
- `inventory.expired`

Audit actions mirror the same verbs. Reservation/expiry audit rows use SYSTEM actor where no human actor exists. No event payload contains payment data or identity documents.

## 7. Configuration

`.env.example` additions:

```dotenv
INVENTORY_EXPIRY_ENABLED=false
INVENTORY_EXPIRY_POLL_MS=5000
INVENTORY_EXPIRY_BATCH_SIZE=100
```

The worker remains opt-in. `infra/docker-compose.yml` is still an infrastructure-only compose file (PostgreSQL/PostGIS, Redis, Keycloak, MinIO, Mailpit); it does not yet define API/web/worker application services. Application processes are run with `npm run dev:api`, `npm run dev:web`, `npm run dev:worker`. Containerized application services remain a deployment-preparation task.

## 8. Verification

Executed against the isolated test database and Redis DB 15:

- `npm run db:validate`: PASS
- `npm run db:generate` + `npm run build:packages`: PASS
- `npm run typecheck`: PASS
- `npm run build:api`: PASS
- `npm run build:worker`: PASS
- `npm test`: **108 tests / 19 files PASS**
- `npm run test:integration`: **75 tests / 14 files PASS**
- `python tools/validate_design_artifacts.py`: **10 passed / 0 failed**
- Migrations `0020` and `0021` applied to `getstoopy_foundation_test` only; grants re-run PASS.

New integration coverage (`tests/integration/inventory.test.ts`, 5 tests):

1. Initialize/adjust idempotency, version conflict, bounds, staff read-only, stranger 404, audit rows.
2. Concurrent oversell prevention, idempotent reserve/release/consume, terminal-state rejection, public availability projection.
3. Worker expiry releases due reservations exactly once and rejects late consume.
4. Runtime write denial, append-only movement denial, deferred balance/movement invariants, quantity/TTL validation.
5. Fail-closed stock writes/reservations and public catalog after vendor KYC revocation.

## 9. Known limits / next slice

- Reservation commands are not yet wired to cart/checkout; there is no customer-facing checkout API.
- Public availability is a projection, not a guarantee until checkout reserves atomically.
- Expiry worker is disabled by default and must be enabled explicitly in each environment.
- Store pickup geometry/hours/service-area approval remains pending.
- Next dependency-ordered slice: **cart + checkout quote orchestration** using these reservation commands, followed by verified payment/COD adapters.
