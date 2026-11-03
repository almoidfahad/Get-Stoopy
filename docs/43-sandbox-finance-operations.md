# 43 — Sandbox refund/adjustment journals, reconciliation and payout lifecycle

Date: 2026-11-03. Owner selected **full sandbox flow**, not live money movement. Migrations 0050–0054 are additive and were applied only to the isolated development/test database.

## Activation boundary

`PAYOUTS_SANDBOX_ENABLED=true` is permitted only outside production. `PAYOUTS_LIVE_ENABLED=true` still fails configuration loading. The only adapter is `SANDBOX_MANUAL`: deterministic local code, no network I/O, no bank/MFS credentials and no real transfer. Every response is `mode: TEST_ONLY`, `liveEnabled: false`, `moneyMoved: false`. A sandbox `SUCCEEDED` state means the synthetic statement matched; it is never evidence of real payment.

## Refund and adjustment journals

- Existing buyer cancellation/refund review remains the entry point. Approval now atomically reserves customer refund payable: debit vendor-sales clearing, credit customer-refund payable. Rejection creates no execution/journal.
- A separate scoped step-up executor may submit the reserved sandbox refund. UNKNOWN keeps the reservation intact and records an append-only attempt; retry uses the same provider key. Submission is not completion.
- A scoped step-up reconciliation importer matches a synthetic statement by exact provider reference, amount, currency and country. SUCCEEDED debits refund payable and credits TEST_ONLY sandbox cash. FAILED releases the reservation back to clearing. Both paths write an immutable balanced journal and append-only statement.
- Approved vendor settlements can receive signed integer adjustments with evidence hash and reason. Maker and checker must differ. Positive adjustments credit vendor payable; negative adjustments debit it. Cumulative payable cannot become negative. Adjustments are blocked once a payout reservation exists.
- Refund/adjustment history is never edited. Production provider refunds, chargebacks and partial-return proration remain separate integrations.

## Payout reservation → submission → reconciliation

1. An approved settlement, verified destination/cooldown, active vendor KYC and no unresolved linked refund are required.
2. Approved adjustments are included; pending adjustments block reservation. Net payable is reserved exactly once: debit vendor payable, credit sandbox payout-reserved liability.
3. A scoped step-up executor submits the deterministic sandbox provider key. UNKNOWN remains reserved; successful submission becomes SUBMITTED. Attempt numbers and command keys are unique and append-only.
4. Exact synthetic statement reconciliation completes SUCCEEDED (debit reserved, credit sandbox cash) or FAILED (debit reserved, credit vendor payable). Completion requires the statement and completion journal in the same transaction; deferred DB triggers reject bypass.
5. Terminal transfers cannot be resubmitted or reconciled again. Duplicate commands replay; changed payloads conflict.

## API and defense

Routes under `/api/v1`: `POST admin/vendor-settlements/{id}/adjustments`, `POST admin/finance-adjustments/{id}/review`, `POST admin/vendor-settlements/{id}/payout-reservations`, `POST admin/sandbox-transfers/{refunds|payouts}/{id}/submit`, `POST …/reconcile`, and owner/finance `GET sandbox-transfers/{refunds|payouts}/{id}`. Mutations require session/CSRF, explicit permission, country scope and step-up. PostgreSQL enforces privileged writes, forced RLS, immutable snapshots, exact statement matching, journal links, append-only attempts/statements and deferred completion evidence. Runtime has no write grants.

## Verification boundary

Tests cover refund approval reservation, UNKNOWN retry, exact-once reconciliation, balanced journals, owner visibility/foreign denial, statement tamper denial, adjustment maker–checker and negative payable adjustment, payout reservation after adjustment, UNKNOWN retry, terminal completion and late-adjustment denial. Existing settlement/COD/destination tests remain required.

This slice does not authorize live payout, production deployment, real provider credentials, bank beneficiary verification or regulatory compliance. Those require provider contract/capability evidence, secure credential configuration, independent security review and separate owner authorization. Next planned slice remains admin activation and KYC retention automation.
