# Vendor suborder fulfillment readiness

Last updated: 2026-11-02.

Status: **implemented and locally integration-tested development slice**. This is the vendor-readiness prerequisite for dispatch. It is **not** rider dispatch, pickup/OTP proof, cancellation/restock, refunds, settlement or production readiness.

## 1. Scope

This slice implements the first vendor-side suborder lifecycle after an order exists:

```text
PENDING_VENDOR → ACCEPTED → PREPARING → READY_FOR_PICKUP
PENDING_VENDOR → REJECTED (terminal)
```

- Accept requires a bounded preparation estimate: **1–1440 minutes**.
- Start preparation is a separate explicit command.
- Ready is a **manual vendor confirmation**. A preparation timer cannot confirm ready.
- Reject requires an 8–512 character reason and is terminal in this slice.
- Every transition is versioned, idempotent by command key, audited, emitted to the outbox and recorded in append-only `VendorSuborderStatusEvent` history.
- Readiness commands fail closed unless the parent order is `PAYMENT_VERIFIED` or `AWAITING_COD`, the store is `ACTIVE`, and the vendor remains KYC-eligible.

Dispatch states such as `FULFILLING`, `DELIVERED`, `COMPLETED`, exceptions and returns remain future slices. The older logical `suborderTransitions` map still describes the wider target lifecycle; the executable readiness guard intentionally allows only the path above.

## 2. Migrations and schema

Applied only to the isolated local test database `getstoopy_foundation_test`:

| Migration | Purpose |
|---|---|
| `0025_vendor_suborder_status_values` | Additive enum values: `ACCEPTED`, `REJECTED`, `PREPARING`, `READY_FOR_PICKUP`. Separate migration because PostgreSQL cannot consume new enum values in the same transaction. |
| `0026_vendor_suborder_readiness` | Readiness columns, append-only status history, store-scoped membership column, database guards, RLS policy updates and comments. |

Executable schema now has **53 Prisma models**.

New/changed persistence:

- `VendorMembership.storeId` optional UUID. `NULL` means vendor-wide; a non-null value limits the membership to one store of the same vendor/country. OWNER memberships must remain vendor-wide. The existing `UNIQUE(vendorId,userId)` is retained, so a user currently has at most one membership per vendor; multi-store membership grants and regrant-after-revoke remain pending.
- `VendorSuborder` adds `acceptedAt`, `acceptedByUserId`, `preparationMinutes`, `preparationStartedAt`, `readyConfirmedAt`, `readyConfirmedByUserId`, `rejectedAt`, `rejectedByUserId`, `rejectionReason`, plus a vendor/status/createdAt index.
- `VendorSuborderStatusEvent` records `fromStatus`, `toStatus`, `suborderVersion`, actor, command key, payload hash, optional reason/preparation minutes and occurrence time. It is unique by `(suborderId,commandKey)` and `(suborderId,suborderVersion)`.

Database invariants:

- Suborder identity, order/vendor/store ancestry, currency, subtotal and creation time are immutable.
- Every update increments version by exactly one and must match the implemented readiness transition.
- Accept/reject/ready metadata is written once and cannot be rewritten later.
- The acting database session user must match the recorded accept/reject/ready actor.
- A deferred constraint requires a matching status-history event for every suborder update.
- Status history is append-only; privileged role has INSERT/SELECT but not UPDATE/DELETE.
- Runtime role has SELECT only on suborders/history; writes go through the privileged service path after authorization.
- RLS suborder/order-item/history reads honor store-scoped memberships and active vendor status. API session context additionally resolves memberships only for ACTIVE KYC-eligible vendors.

`scripts/db-grants.sql` was updated and re-run after migration. It now grants bounded `UPDATE` on `VendorSuborder` to `gs_privileged` while still denying DELETE, and adds append-only history grants.

## 3. HTTP surface

All routes are under `/api/v1`, require an opaque session, and mutations require Origin + CSRF. Vendor permission is `vendor:order:read` or `vendor:order:write` through the vendor-membership authorization path, not global admin RBAC.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/vendor/stores/:storeId/suborders` | `vendor:order:read` | Store-scoped list; optional status filter; limit 1–100 and UUID cursor. |
| GET | `/vendor/suborders/:suborderId` | `vendor:order:read` | Vendor projection with immutable item snapshots and parent payment status. |
| GET | `/vendor/suborders/:suborderId/history` | `vendor:order:read` | Append-only transition history, newest version first. |
| POST | `/vendor/suborders/:suborderId/accept` | `vendor:order:write` | `expectedVersion`, `commandKey`, `preparationMinutes`. |
| POST | `/vendor/suborders/:suborderId/reject` | `vendor:order:write` | `expectedVersion`, `commandKey`, `reason`. |
| POST | `/vendor/suborders/:suborderId/start-preparation` | `vendor:order:write` | `expectedVersion`, `commandKey`. |
| POST | `/vendor/suborders/:suborderId/ready` | `vendor:order:write` | Manual confirmation; `expectedVersion`, `commandKey`. |

Authorization behavior:

- OWNER/MANAGER have read/write; STAFF is read-only.
- A store-scoped membership cannot read or command another store's suborders, even under the same vendor.
- Foreign vendor/store or stranger requests return 404 without leaking existence.
- Staff write attempts return 403.
- Buyer order read remains available through `/orders/:orderId` and now includes suborder readiness fields.

Command behavior:

- `commandKey` must match `^[A-Za-z0-9:_-]{8,128}$`.
- Replaying the same command key and payload returns `duplicate: true`.
- Reusing a command key with a different payload returns `409 FULFILLMENT_IDEMPOTENCY_CONFLICT`.
- Stale `expectedVersion` returns `409 SUBORDER_VERSION_CONFLICT`.
- Skipped/terminal transitions return `409 SUBORDER_INVALID_TRANSITION`.
- Unverified/non-COD parent payment returns `409 SUBORDER_PAYMENT_NOT_READY`.
- Invalid preparation minutes/reason/command key return 400.

Outbox event types:

- `fulfillment.suborder.accepted`
- `fulfillment.suborder.rejected`
- `fulfillment.suborder.preparing`
- `fulfillment.suborder.ready`

Each event includes order/vendor/store IDs, from/to status, version and preparation estimate where applicable. Domain inbox handlers/UI notifications are not implemented yet; the outbox is the durable integration point.

## 4. Core helpers

`packages/core/src/fulfillment.ts` adds pure helpers:

- `vendorReadinessTransitions`
- `assertVendorReadinessTransition`
- `assertPreparationMinutes`
- `assertRejectionReason`
- `assertVendorManualReady`
- `assertFulfillmentCommandKey`

`assertVendorManualReady` reuses the existing `manualReady` invariant and rejects timer-driven confirmation.

## 5. Verification

Local gates against isolated PostgreSQL/PostGIS + Redis:

- `npm test`: **121 tests / 22 files PASS**.
- `npm run test:integration`: **88 tests / 17 files PASS**.
- `npm run typecheck`: PASS.
- `npm run db:validate`: PASS.
- `npm run build:api`: PASS.
- `npm run build:worker`: PASS.
- `python tools/validate_design_artifacts.py`: document/contract validation only.

New integration suite: `tests/integration/fulfillment.test.ts` covers:

1. COD accept → start preparation → manual ready, idempotent replay, payload conflict, stale version, skipped ready, buyer projection and append-only history.
2. Store-scoped manager isolation, read-only staff, stranger/foreign-vendor 404, runtime RLS visibility and store-list isolation.
3. Sandbox payment gate: readiness blocked before verified webhook, allowed after exact amount/currency verification.
4. Rejection reason/bounds, CSRF requirement, terminal rejection and invalid transition after rejection.

The suite uses unique run IDs, does not delete domain rows, drains the outbox, and runs against `getstoopy_foundation_test` only.

## 6. Explicit limitations

- No dispatch run, rider offer, assignment, pickup confirmation, recipient OTP or delivery proof.
- No cancellation, restock, refund or chargeback flow. Rejection currently records a terminal vendor decision but does not reverse payment or inventory.
- No delivery fee/total pricing; orders remain product-subtotal-only.
- No vendor portal UI for these commands yet; runtime Swagger/API is the implemented surface.
- No multi-store membership per user, membership regrant after revoke, or delegated admin exception override.
- No production deployment, live payment, paid resource or dev/prod database migration.

## 7. Next dependency

The next safe slice is dispatch/delivery foundation: store pickup geometry/hours/service-area approval and rider eligibility/shift/location consent, then atomic 30-second road-route offers and assignment. Earnings/COD liability ledgers must follow immutable assignment/delivery proof, not precede it.
