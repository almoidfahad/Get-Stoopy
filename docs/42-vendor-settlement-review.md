# 42 — Vendor settlement calculation and maker–checker review

Date: 2026-11-03. Development-only slice on migrations 0047–0049. **Approval reserves a vendor payable; it does not transfer money, mark a settlement paid, or enable a payout provider.**

## Implemented boundary

- An independent, country-scoped finance administrator with `finance:commission:manage` and recent step-up creates an append-only vendor commission/hold policy. The vendor owner cannot create their own policy. Commission is 0–9999 basis points; hold is 0–90 elapsed days. Currency comes from the vendor's country, not the request.
- A policy must have both `effectiveFrom` and `createdAt` no later than delivery completion. The latest eligible policy is selected. Later policies never rewrite an earlier completed sale. There is no implicit/default commission.
- A separate maker with `finance:settlement:prepare` selects 1–100 distinct completed suborders of one vendor, one currency and one funding source (all COD or all verified prepaid). The vendor owner cannot prepare their own settlement.
- Gross is the immutable suborder product subtotal. Commission is floored to an integer minor unit **per suborder**; net = gross − commission. Totals sum those integer results. The current slice does not invent tax, delivery-fee, adjustment or partial-refund proration.
- Each suborder may occur in at most one pending/approved settlement. A rejected settlement releases its items for a new, separately reviewed attempt; history is retained.
- A verified, owner-submitted payout destination is required at preparation and again at approval. Its development 24-hour cooldown must have elapsed, and vendor activation/KYC must remain valid (`docs/41-vendor-payout-destinations.md`).
- COD requires the entire linked collection to be allocated to independently verified deposits. Pending/rejected deposit evidence never qualifies. Prepaid requires `PAYMENT_VERIFIED`; this is not a claim of live provider/bank reconciliation.
- Any linked refund request conservatively blocks preparation and approval until a future refund/adjustment reconciliation slice exists. Completed orders, active order lifecycle and completed delivery are required.
- The configured hold must have elapsed at preparation and approval. Days are exact elapsed 24-hour periods, not an invented business-day/holiday calendar.
- A different checker with `finance:settlement:review`, country scope and step-up approves or rejects with a reason and expected version. Maker and checker cannot be the same user. Commands are idempotent; changed payloads with the same key conflict.

## Journal semantics

Approval atomically writes a balanced, immutable journal keyed `vendor-settlement-{settlementId}`:

| Funding source | Debit | Credit | Credit when commission > 0 |
|---|---|---|---|
| COD | `cod-clearing:{countryId}:{currency}` (liability) for gross | `vendor-payable:{vendorId}:{currency}` for net | `commission-revenue:{countryId}:{currency}` |
| Verified prepaid | `vendor-sales-clearing:{countryId}:{currency}` (asset/clearing) for gross | same vendor payable for net | same commission revenue |

The prepaid clearing account is **not company cash** and does not prove that a provider has remitted funds. Provider settlement reconciliation remains a separate gate before any real disbursement. Mixed COD/prepaid batches are rejected rather than charged to an arbitrary source. Rejection writes no journal. Approval is terminal in this slice; corrections require a future explicit reversal/adjustment workflow, never ledger edits.

## API (under `/api/v1`)

| Method | Path | Authority |
|---|---|---|
| POST | `/admin/vendor-commission-policies` | commission manage + scope + step-up |
| POST | `/admin/vendor-settlements` | settlement prepare + scope + step-up |
| GET | `/admin/vendor-settlements?countryId=…` | settlement review + scope + step-up |
| POST | `/admin/vendor-settlements/{id}/review` | independent settlement reviewer + scope + step-up |
| GET | `/vendors/{vendorId}/settlements` | owning vendor |
| GET | `/vendor-settlements/{id}` | owning vendor or scoped step-up reviewer |

All mutations require session/CSRF controls. Settlement responses include integer strings for minor units, status/version, `execution: "DISABLED"` and `moneyMoved: false`. There is no `PAID` status or execute endpoint. The historical OpenAPI paths remain proposed design contracts; `x-implementation-reference` points to these actual routes without claiming that the proposed provider-execution contract is implemented.

## Database and authorization defense

Four tables: `VendorCommissionPolicy`, `VendorSettlement`, `VendorSettlementItem`, `VendorSettlementReview`. Policies/items/reviews are append-only; settlement identity/calculation is immutable and permits only version-incrementing terminal review. Privileged-only writes, forced RLS, owner/super reads, independent actors, destination/KYC checks, exact arithmetic, hold/COD/refund gates and deferred totals/review/payable-journal checks plus COMMIT-time homogeneous funding, hold, lifecycle and refund rechecks (0049) are enforced in PostgreSQL as well as the service. Runtime DELETE and append-only UPDATE privileges are revoked. Vendor row locks serialize preparation/review for the same vendor. Audit and outbox rows commit in the same transaction.

## Verification and remaining gaps

Core tests cover integer rounding, invalid rates/amounts, totals and exact hold calculation. Dispatch integration fixtures cover policy creation, destination cooldown, unpaid COD, verified deposit allocation, permission/self-review denial, idempotency, balanced three-line approval, duplicate-suborder prevention, owner visibility/RLS, item tamper denial, active hold, rejection without a journal and retry after rejection. Time-dependent service checks use an injected test clock; no production cooldown is shortened and authentication/session expiry is not faked.

Still pending: owner-approved commercial commission/hold defaults, business-day/holiday schedule, automatic period selection, refund/adjustment proration and journals, provider remittance reconciliation, payout reservation/execution/retry, notifications, finance UI, production KMS/key rotation and deployment authorization. No live payment or payout was exercised. This is not a claim of full marketplace completion.
