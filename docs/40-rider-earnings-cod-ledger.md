# 40 — Rider earnings and COD liability/deposit ledger

Status: **development slice implemented and locally integration-tested; live payout/provider transfer remains disabled.** No production rate, payout destination, bank/MFS integration or production deployment is introduced. Applied migrations `0001`–`0039` are not edited; this slice adds `0040`–`0043`.

## Safety boundary

Cash collected from a recipient is company money held by the rider, never rider income. A rider-entered deposit reference or screenshot hash is **evidence only**; it cannot reduce COD due until a scoped finance reviewer verifies it against trusted company records. COD is never silently netted against earnings. The customer delivery fee and rider earning remain separate policies.

This slice implements the first executable rider-finance path:

1. An admin-configured, country/currency **rate rule** with contiguous road-distance slabs.
2. An immutable **rate snapshot** created atomically when a rider accepts a dispatch offer.
3. A completion-time **earning accrual** journal for every completed delivery.
4. A completion-time **COD custody collection** journal for COD orders.
5. Rider deposit submission, finance maker–checker verification/rejection, and FIFO allocation of verified deposits to outstanding collections.
6. A per-currency rider wallet read model that keeps earnings and COD due separate.

It does **not** implement withdrawals, Sunday payout scheduling, provider transfers, earning deductions, COD-offset policy, bank-account verification, tax, or vendor settlement. `withdrawableMinor` is `null` and `payoutEnabled=false`.

## Rate rules and snapshots

- `POST /api/v1/admin/rider-rate-rules` requires `finance:rider-rate:manage`, recent step-up, CSRF and a country admin scope matching the rule country.
- Slabs are integer meters, lower-inclusive/upper-exclusive, sorted from 0, contiguous, with exactly one open-ended final slab. Gaps, overlaps, zero/negative amounts and more than 50 slabs fail closed.
- The current schema is **country + currency** scoped. City/zone-specific rules, minimum/maximum caps and routing-method overrides are explicitly pending; the road distance always comes from the approved dispatch road-route evidence, never a straight-line fallback.
- Acceptance locks the dispatch offer/rider and writes `RiderRateSnapshot` in the same transaction as `RiderAssignment`. No active effective rule returns `RIDER_RATE_REQUIRED`; distance outside slabs returns a conflict. Later rate-rule changes cannot rewrite the snapshot.
- The snapshot is bound to assignment, rider, country, road distance, route-evidence hash, rule/slab and amount. Database triggers reject mismatched snapshots.

## Completion accounting

Delivery completion remains fail-closed. After the normal pickup/OTP/prepaid gates:

- Every `COMPLETED` delivery must have exactly one `RiderEarning` at COMMIT.
- The current DB guard requires each completed COD delivery to have exactly one `CodCollection` at COMMIT, with amount/currency equal to the stored **order amount**. This amount is product subtotal only, not a customer final total; for a multi-suborder order, repeating it per delivery would overcount. Application-level restrictions in `docs/179-cod-multi-delivery-safety.md` now block new dispatch and completion of such orders; the database constraint itself does not prevent that overcount.
- Migration `0042` replaces the old hard COD block with a snapshot requirement plus a deferred `delivery_finance_consistent` trigger; `0043` fixes a PL/pgSQL variable/alias ambiguity. Prepaid completion still requires `PAYMENT_VERIFIED`.

Journals are balanced, positive-minor-unit, hash-deduplicated and posted inside the completion transaction:

| Event key | Debit | Credit |
|---|---|---|
| `rider-earning-{deliveryId}` | `delivery-expense:{countryId}:{ccy}` (EXPENSE) | `rider-earning-payable:{riderId}:{ccy}` (LIABILITY) |
| `cod-collection-{deliveryId}` | `rider-cod-custody:{riderId}:{ccy}` (ASSET) | `cod-clearing:{countryId}:{ccy}` (LIABILITY) |
| `cod-deposit-{depositId}` | `company-cod-cash:{countryId}:{ccy}` (ASSET) | `rider-cod-custody:{riderId}:{ccy}` (ASSET) |

The Prisma-transaction journal helper uses the same `LedgerJournal`/`LedgerLine` primitives as `packages/ledger`: unique `businessEventKey`, payload-hash idempotency, positive BIGINT amounts, ≥2 lines and net-zero at COMMIT. A replay with a different payload is `LEDGER_IDEMPOTENCY_CONFLICT`.

## Deposits and maker–checker review

Supported evidence channels are `COMPANY_OFFICE`, `BANK` and approved `MERCHANT_MFS`. Personal rider/vendor accounts are not company destinations. Submission stores amount, currency, channel, external reference, evidence hash, rider/country, command key and payload hash; it creates **no journal** and leaves status `PENDING_REVIEW`.

Review requires `finance:cod:review`, recent step-up, CSRF and country scope. The submitter cannot review their own deposit (`SELF_REVIEW_DENIED`). Review is terminal and idempotent:

- `REJECT` records reviewer/reason/version with no journal and no COD reduction.
- `VERIFY` serializes per rider+currency with a transaction advisory lock, allocates FIFO to outstanding `CodCollection` rows, posts the deposit journal, then writes `CodAllocation` rows and marks the deposit `VERIFIED` in the same transaction.
- Allocation cannot exceed the deposit or any collection. Overpayment is rejected as `COD_DEPOSIT_EXCEEDS_DUE`; unmatched/overpaid reconciliation remains a future manual queue.
- Duplicate rider+channel+external reference is unique. Command-key replay returns the same deposit; changed payload returns `DEPOSIT_IDEMPOTENCY_CONFLICT`. Stale version returns `DEPOSIT_VERSION_CONFLICT`; an already reviewed deposit returns `DEPOSIT_ALREADY_REVIEWED`.

## Wallet read model

`GET /api/v1/riders/me/wallet` returns only the authenticated rider's own balances, grouped by currency:

```json
{
  "riderId": "…",
  "balances": [
    { "currency": "BDT", "earningsPostedMinor": "6000", "codCollectedMinor": "1000", "codVerifiedDepositsMinor": "1000", "codDueMinor": "0" }
  ],
  "withdrawableMinor": null,
  "payoutEnabled": false
}
```

Currencies are never summed together. `codDueMinor = codCollectedMinor − verified allocations`; pending or rejected deposits do not appear as paid. There is no withdrawal button or payout execution path in this slice.

## API

| Method | Path | Authorization | Result |
|---|---|---|---|
| POST | `/api/v1/admin/rider-rate-rules` | `finance:rider-rate:manage` + step-up + country scope + CSRF | immutable rule + slabs; idempotent |
| POST | `/api/v1/riders/me/cod-deposits` | active rider session + CSRF | pending evidence submission; no balance reduction |
| GET | `/api/v1/riders/me/wallet` | rider session | own per-currency earnings/COD read model |
| GET | `/api/v1/admin/cod-deposits?countryId=…` | `finance:cod:review` + step-up + country scope | pending review queue, max 100 rows |
| POST | `/api/v1/admin/cod-deposits/{depositId}/review` | same reviewer permission, step-up, scope; not submitter + CSRF | terminal VERIFY/REJECT; verified journal + FIFO allocations |

## Persistence and authorization

- Additive migrations: `0040_rider_finance_enums`, `0041_rider_earnings_cod_ledger`, `0042_delivery_completion_finance_gate`, `0043_delivery_finance_guard_variable_fix`.
- New tables: `RiderRateRule`, `RiderRateSlab`, `RiderRateSnapshot`, `RiderEarning`, `CodCollection`, `CodDeposit`, `CodAllocation`.
- RLS: riders read only their own snapshot/earning/collection/deposit/wallet rows; finance writes are privileged-service only. Runtime has no write grants. Append-only tables have UPDATE/DELETE revoked from the privileged role.
- `scripts/db-grants.sql` grants the new guard functions and applies append-only revokes. `scripts/seed-local.ts` defines `finance:rider-rate:manage` and `finance:cod:review` as critical permissions without attaching them to a generic admin role.
- Audit and outbox events are written in the same transaction as deposit submission/verification and rate creation.

## Verification

Local isolated PostgreSQL/PostGIS + Redis coverage includes: rate permission/step-up/scope, slab-gap rejection, rule idempotency/conflict and slab immutability; completion earning/COD journals balanced and exactly once; rider-only RLS; pending evidence leaving COD due unchanged; scoped step-up verification, replay and overpayment rejection; rejection without journal; self-review denial; and append-only tamper rejection.

Run the normal gates: `npm run db:generate`, `npm run db:validate`, `npm run typecheck`, `npm test`, `npm run test:integration`, and `python tools/validate_design_artifacts.py`. The design OpenAPI remains the proposed Phase-1 contract; this document records the implemented development subset, not live-provider certification.

## Remaining work

City/zone rate rules, minimum/maximum caps, approved production rates, earning deductions, COD-offset policy, withdrawal requests, verified payout destinations, Sunday/manual payout windows, provider payout adapters and reconciliation, unmatched/overpaid deposit queues, reversals/adjustments, notifications, admin/rider UI, and vendor commission/settlement remain pending. The next finance dependency is vendor settlement/payout review with verified destinations; live money movement still requires separate authorization.
