# 39 — Pre-dispatch cancellation, restock and refund review

Status: **development slice implemented and locally integration-tested; live refund execution remains disabled.** This slice does not move money, post a refund journal, enable a provider refund API, deploy production or change applied migrations `0001`–`0036`.

## Scope and safety boundary

The first executable cancellation path is deliberately narrow:

- The **buyer** may cancel their own **whole parent order** only while every vendor/store suborder is `PENDING_VENDOR` or `REJECTED` and no dispatch run exists.
- Online orders must have a terminal payment result. `AWAITING_PAYMENT` returns `PAYMENT_RESOLUTION_REQUIRED`; an unresolved or unknown payment can never race a restock.
- `ACCEPTED`, `PREPARING`, `READY_FOR_PICKUP`, dispatch, delivery and completed states close this cancellation window. Partial cancellation, post-dispatch cancellation, returns and vendor-rejection automation are separate future slices.
- COD and failed-payment orders cancel without a refund request. A verified prepaid order creates one full-amount `RefundRequest` in `PENDING_REVIEW`.
- A scoped, step-up finance reviewer may approve or reject the exact request once. Approval is a **review decision only**: `execution=DISABLED`, `moneyMoved=false`. Provider execution and balanced refund-ledger posting remain fail-closed until the ledger/provider slices exist.

## Atomic transition

One privileged transaction locks the parent order, checks the idempotency key and expected version, then:

1. transitions `Order.lifecycleStatus` from `ACTIVE` to `CANCELLED`;
2. writes an append-only `OrderCancellation` snapshot (buyer, country, payment state, amount, currency, reason, order version);
3. transitions every suborder to `CANCELLED` with append-only status events;
4. returns each consumed reservation quantity to `Inventory.onHand` through a new append-only `RESTOCK` movement. The reservation remains terminal `CONSUMED`; `reserved` is unchanged. A partial unique index permits only one restock per reservation;
5. for a verified payment, creates the refund request from the stored order/intent amount and currency, never from client input;
6. writes audit rows and outbox events in the same transaction.

Deferred database triggers reject a cancelled order without its cancellation record, complete suborder cancellation, complete restock set, dispatch-free proof and correct refund-request cardinality. Inventory lock ordering is stable across multi-vendor cancellations. Any failure rolls back the whole aggregate.

## API

| Method | Path | Authorization | Result |
|---|---|---|---|
| POST | `/api/v1/orders/{orderId}/cancellation` | buyer session + CSRF | `{ expectedVersion, commandKey, reason }`; idempotent full cancellation/restock; refund request only for verified prepaid |
| GET | `/api/v1/orders/{orderId}` | buyer | now includes `lifecycleStatus` and cancellation/refund summary |
| GET | `/api/v1/refunds/{refundId}` | owning buyer | minimized refund-review state; no provider secrets |
| GET | `/api/v1/admin/refunds?countryId=…` | `finance:refund:review` + step-up + country scope | pending review queue, maximum 100 rows |
| POST | `/api/v1/admin/refunds/{refundId}/review` | same reviewer permission, step-up, scope; not the buyer | `{ expectedVersion, decision: APPROVE|REJECT, commandKey, reason }`; terminal, idempotent, no execution |

Stable conflicts include `PAYMENT_RESOLUTION_REQUIRED`, `CANCELLATION_WINDOW_CLOSED`, `ORDER_VERSION_CONFLICT`, `CANCELLATION_IDEMPOTENCY_CONFLICT`, `REFUND_SNAPSHOT_MISMATCH`, `REFUND_VERSION_CONFLICT`, `REFUND_ALREADY_REVIEWED` and `REFUND_IDEMPOTENCY_CONFLICT`. Foreign resources return 404.

## Persistence and authorization

- Additive migrations: `0037_cancellation_refund_enums`, `0038_cancellation_restock_refund_review`, and additive guard correction `0039_suborder_delivery_cancel_guard` (restores the full delivery state machine from 0032 while retaining the new cancellation branch).
- New tables: `OrderCancellation`, `RefundRequest`, `RefundReview`; new order lifecycle and refund-review enums; `RESTOCK` inventory movement kind and cancellation link.
- RLS: buyers read only their own cancellation/refund rows; writes are privileged-service only. Reviewer authority is checked in the service from the current session context, including geographic scope and recent step-up. Self-review is denied.
- Cancellation and review history are append-only. Runtime has no write grants; privileged update/delete grants are revoked where history must remain immutable.
- `scripts/seed-local.ts` defines `finance:refund:review` as a critical permission but does **not** attach it to the generic country-admin role or fabricate a reviewer identity.

## Verification

Local isolated PostgreSQL/PostGIS + Redis tests cover: unresolved-payment blocking; foreign-order isolation; concurrent duplicate cancellation; exact-once multi-vendor restock; consumed-reservation terminality; COD without refund; verified-prepaid refund request; scoped step-up review; self-review denial; approve/reject terminality and idempotency; append-only history; no ledger journal or money movement on approval; and direct database lifecycle/restock invariant failures.

Run the normal gates: `npm run db:generate`, `npm run db:validate`, `npm run typecheck`, `npm test`, `npm run test:integration`, and `python tools/validate_design_artifacts.py`. The design OpenAPI remains the proposed Phase-1 contract; this document records the implemented development subset and must not be read as live-provider certification.

## Remaining work

Automatic vendor-rejection cancellation/refund orchestration, partial cancellation/refund proration, post-dispatch exceptions, returns, refund liability/settlement journals, provider refund adapters and reconciliation, customer notifications, and the admin UI remain pending. COD completion still requires verified COD accounting. Rider earnings/COD liability and deposit ledger are the next dependency slice.
