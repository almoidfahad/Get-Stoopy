# Finance, COD, rider earnings and delivery policy

**Status:** design proposal with explicit approval points. No financial operation has been executed. Historical rates and screenshot amounts are examples only.

## 1. Money representation and source of truth

Use PostgreSQL `BIGINT` minor units and ISO currency per journal (BDT poisha initially); never binary floating point. Define rounding once per line and allocate discounts/tax deterministically so line sums equal parent totals. Percentages use basis points. A UI wallet is a projection of immutable ledger accounts, not an editable balance field.

Every journal balances debits and credits per currency. Runtime DB permissions deny ledger UPDATE/DELETE; corrections are linked reversals. Unique business-event keys prevent duplicate completion earnings, verified deposits, refunds and payout reservations. Balance snapshots are rebuildable and reconciled. Separate accounts/purposes:

- Vendor gross receivable, commission, refund/adjustment, pending and completed settlement.
- Rider delivery earnings, approved deductions, payout reserve and paid payout.
- Rider COD custody/amount due, verified COD deposit clearing and allocations.
- Gateway/QR/bank/cash clearing, platform delivery revenue, promotion subsidy, tax and payment fees.

Cash collected from a recipient is **not** rider income. A screenshot or rider-entered “deposit successful” is **not** a verified company receipt. A payout instruction is not proof of successful transfer until the approved provider/bank evidence confirms it.

## 2. Quote, commission and settlement

Customer quote: product subtotal − eligible discounts + delivery fee + applicable tax/transparent charges = total. Multiple vendor/store groups have independently allocated totals. Delivery price to the customer and rider compensation are separate policies; a free-delivery campaign does not imply a zero-cost rider.

Commission rule dimensions: country, city, zone, vendor, category and order type; percentage or fixed amount. Proposed precedence: explicit vendor/category combination → vendor → category/zone → category/city → category/country → zone/city/country default. Exact precedence must be approved and stored as a policy version; ambiguous equal-priority rules are rejected. Default basis is discounted product subtotal excluding delivery and tax unless a future approved rule says otherwise.

Commission becomes earned according to the configured successful-order policy, proposed at delivery completion; cancellation before completion does not create normal commission. Partial cancellation/refund uses a snapshot and an explicit proration/reversal policy. No retrospective recalculation when a rule changes.

Vendor net payable = eligible gross product sales − earned commission − refunds − approved adjustments, with delivery/tax liabilities tracked separately. Settlement eligibility requires verified payout destination, financial checks and configured return/hold policy. Historical COD discussion proposed waiting for verified company deposit: adopt as a conservative configurable gate, subject to owner approval. Settlement days for vendors remain configurable; no invented final Wednesday/Saturday schedule. Initial maker–checker manual settlement, later approved provider automation. Direct vendor acquiring/QR settlement must be reconciled, not paid a second time from the platform ledger.

## 3. Rider fixed-distance pay

Super Admin configures country/city/zone rule versions, effective dates, active status, distance slabs, minimum, optional maximum and routing method. Slabs use integer meters, lower-inclusive and upper-exclusive: `[0,2000)`, `[2000,4000)`, `[4000,6000)`. Exactly 2,000m belongs to the second slab. Validate no gaps/overlaps; out-of-range distance escalates rather than silently inventing a rate. Optional maximum is a cap, not a hidden deduction.

**Distance basis:** verified pickup store → recipient destination road route, using configured vehicle/routing method. Rider → store road distance is used for dispatch ranking only. Do not pay extra for the rider's unrelated travel, traffic or waiting time. Traffic-aware ETA is allowed; it does not change fixed slab compensation. Historical suggestions of ৳30/45/60 and time-based bonuses are not approved rates; final master explicitly rejects the latter.

**Snapshot point:** final rider acceptance creates the assignment and immutable rate/route snapshot atomically (proposed default). If business chooses offer time instead, record that policy before implementation. Route recalculation for navigation does not rewrite earnings. A materially wrong pickup/destination or reassignment requires an audited exception/new delivery attempt and reversal where appropriate, never silent historical edits.

Normal earning credit occurs only after successful delivery completion, recipient verification and required COD accounting. Failed/refused delivery has no normal earning; any separately approved cancellation compensation would be a distinct policy/journal, not an automatic distance credit.

## 4. Atomic dispatch and delivery invariants

1. Vendor manually confirms ready; preparation timer cannot do it. Executable readiness path and append-only history: `docs/35-vendor-suborder-fulfillment-readiness.md`.
2. Create dispatch run; shortlist active, KYC-approved, consented, online, in-zone riders with fresh accurate location and available capacity.
3. Use PostGIS for candidate filtering, then provider road-route matrix for ordering. Stable tie-breaker: configured priority → road distance → oldest offer fairness → rider ID. No straight-line fallback when road distance is required.
4. Lock dispatch row; ensure no unexpired offer; create one 30-second offer using DB time. Commit, then emit socket/push hint.
5. Acceptance locks offer, delivery and rider; checks token, status, expiry, current eligibility/capacity. Reject/timeout closes offer; create one active assignment on success.
6. Delayed jobs are only wakes: database expiry/status decides. A BullMQ retry or duplicated socket cannot create a second assignment.
7. Exhaustion goes to local dispatch queue/manual fallback. Manual assignment obeys the same KYC/zone/capacity checks and requires reason/audit. Temporary neighboring-zone grants expire.
8. Pickup confirmation and recipient OTP are separate events. OTP is hashed/peppered, short-lived, rate-limited, attempt-limited and never logged or exposed to unrelated users. An authorized proof-of-delivery exception is distinct and reviewed.

One active delivery per rider initially; batching is a future explicitly approved feature. A rider going out of zone stops new offers and raises an alert, but does not automatically cancel an already assigned delivery. End shift stops new offers; active delivery completes or transfers safely.

## 5. Rider balance explanation

Display separately:

```text
Completed delivery earnings (period / lifetime)
Approved deductions (itemized)
Payout reserve / pending payout
Paid payout
COD cash collected
Verified COD deposits
COD still due to company
Withdrawable earnings
Next scheduled payout and destination status
```

Proposed withdrawable = posted eligible earnings − approved earning deductions − reserved/in-flight/paid amounts − **explicitly authorized** COD offset reserve. COD due remains separately visible even when an approved offset applies. Never silently net all COD from earnings or describe COD custody as spendable balance. Automatic COD offset requires an approved, disclosed policy and a balanced transfer journal; otherwise collect deposits independently.

## 6. Sunday payout

- Schedule: every Sunday in the country's operational timezone; BD `Asia/Dhaka`. Proposed weekly earning cutoff and Sunday processing hour are pending business approval; store exact UTC instant and local period label.
- Default preference: automatic payout **enabled**, but eligibility blocked until a supported verified MFS/bank destination exists. No bank details means no bank payout; do not fabricate one.
- Separate manual withdrawal request and bank-account option. Manual request uses the same destination, risk, balance and COD checks; Sunday-only vs additional manual window is a policy decision, with the final master's Sunday default retained.
- Unique schedule key per rider/period/destination policy; reserve balance before network call. Retry the same provider idempotency key. Unknown result stays reserved and reconciles; never create a fresh payout just because a timeout occurred.
- Successful payout transfers reserve to paid/cash clearing; failure releases reserve through a linked compensating journal. Paid payout cannot be “unpaid” by deleting a row.
- Weekly counters may reset their display period, but transaction history and cumulative ledger never reset/delete. Show calculation, adjustment, fee, tax and provider reference for every payout.
- Holiday/provider outage policy must be approved: next business day vs same Sunday attempt; record actual schedule reason. No claim of instant payout where the rail does not support it.

## 7. COD reconciliation

Supported submission channels: company-office cash, bank deposit, approved **merchant** MFS deposit. Personal rider/vendor accounts are not company settlement destinations. Record collection/receipt, expected amount, discrepancy, depositor, channel, merchant account reference, evidence and reviewer.

Office cash uses maker–checker where practical; bank/MFS deposit requires trusted statement/provider reconciliation, not an uploaded screenshot alone. Pending evidence does not reduce COD due. Verified deposit posts once and allocations cannot exceed deposit or outstanding collection amounts. Partial deposits, overpayments, duplicate references, reversals and unmatched deposits have explicit review queues. Daily reconciliation compares collection → custody → deposit → allocation → vendor settlement eligibility.

## 8. Worked example — TEST ONLY, not rates

Assume product subtotal BDT 1000.00, customer delivery fee 50.00, no tax/discount, approved commission 10%, approved rider slab pay 60.00. Customer total is 1050.00. Vendor product payable before other adjustments is 900.00; platform product commission is 100.00. Delivery revenue is 50.00 and rider delivery expense is 60.00: delivery margin is −10.00 before other costs. This shows why customer delivery fee and rider earnings must not be conflated. For COD, rider custody is 1050.00 until verified deposit; earning is 60.00, not 1110.00. For prepaid, COD custody is zero. Real tax, fees, refunds and subsidy funding require their own lines.

## 9. Historical subscriptions and loyalty (retained, not dropped)

Vendor plans: configurable Free/Basic/Plus/Pro, monthly prices, volume/unit limits, featured-listing/support entitlements, upgrade/downgrade, expiry, payment/subscription history. First-year free introductory access was requested; activation date, eligibility, what “free” includes (subscription vs commission/payment fees), renewal notice and post-trial consent need approval. Never silently charge after a trial. Historical 500/1000/1500 fees and 5000/10000 units are examples only.

Loyalty/cashback/referrals/membership were accepted in the historical conversation. Keep feature-flagged after core finance: append-only award/expiry/reversal events, financial liability for redeemable value, anti-self-referral, qualifying-order rules, budget limits and clear terms. AI may recommend campaigns, not issue unrestricted money.

## 10. Acceptance tests (planned)

- Two identical checkout/payment/completion/deposit/payout commands produce one effect.
- Concurrent rider acceptance yields one active assignment; expired offers fail even if socket arrives late.
- Slab boundary, currency rounding, rate effective-time/timezone, min/max and historical invariance pass.
- Every journal balances; attempted ledger edit/delete fails; reversal restores reconstructable balances.
- COD due and rider earnings remain distinct; partial/unverified/duplicate deposits reconcile correctly.
- Sunday scheduler uses Asia/Dhaka, verified destination, reserve and idempotent retry; missing bank/MFS blocks payout.
- Vendor commission excludes delivery by default; partial refunds and multi-vendor allocation sum exactly.
- Free-delivery subsidy is funded explicitly; subscription trial does not secretly waive or charge other fees.
- Provider outage/unknown result never triggers duplicate money transfer or invented success.
