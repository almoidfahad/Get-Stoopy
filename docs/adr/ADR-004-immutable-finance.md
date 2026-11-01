# ADR-004: Balanced immutable journals, separate COD custody

Status: ACCEPTED for development — owner approval 2026-11-01. Production/provider gates remain. Date: 2026-11-01.

Context: Earnings, COD liability, deposits, commission, refunds, settlements and payouts must reconcile without duplicate money effects or erased history.

Decision: Integer minor-unit double-entry journals with unique business-event keys, matching currency, deferred balance checks and append-only corrections by reversal. VendorLedger/RiderLedger/CODLedger are purpose-specific views over accounts/lines. COD collection is custody, not income. Only verified deposits reduce due. Payout/settlement business records have separate attempt history; reserve before transfer and reconcile unknown results. Weekly period display may reset, history never does.

Consequences: More accounting structure and reconciliation jobs; no generic balance-edit endpoint. Maker–checker, verified destinations, cooldown and provider idempotency remain required. Exact commission precedence, COD offset, Sunday cutoff/holiday policy and vendor settlement hold need owner approval.

Alternatives: Mutable wallet columns are rejected as source of truth. Provider balances alone cannot explain rider COD or marketplace commission.

Review gate: Approve accounting policy and worked example; Phase-2/5/7 concurrency and restore tests must prove invariants. No money has moved.
