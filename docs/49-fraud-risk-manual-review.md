# Phase 3 — Fraud-risk signals and independent manual review (foundation)

Status: **implemented and integration-tested on the isolated local test database.** This is the
data/policy foundation of threat-model item T15. There is **no admin HTTP surface yet**, no
automated enforcement, and no production, payment, payout or AI change.

## What this slice does

A risk case is an evidence-backed queue item for a human reviewer. It is deliberately not an
enforcement mechanism.

| Layer | Artifact |
| --- | --- |
| Pure policy | `packages/core/src/fraud-risk.ts` (`risk-v1`) |
| Schema | `RiskCase`, `RiskSignal`, `RiskCaseReview` + four enums |
| Migrations | `0066_fraud_risk_review`, corrections `0067`, `0068` |
| Grants | `scripts/db-grants.sql` (append-only evidence and reviews) |
| Tests | 7 unit, 8 integration |

### Scoring policy (`risk-v1`)

Weights are a fixed, versioned table, not a model. Repeated evidence for the same code counts
once, so a noisy producer cannot inflate a score. The total is capped at 100.
Bands: `LOW < 30`, `REVIEW >= 30`, `HIGH >= 70`.

Two safety properties are asserted by tests:

1. **No automated enforcement.** `evaluateRisk` always returns `automatedEnforcement: false`.
   Even a `HIGH` band only recommends `MANUAL_REVIEW`; it never bans, blocks, refunds or debits.
2. **A weak network signal cannot queue a customer.** `VPN_OR_PROXY_ONLY` and
   `LOCATION_SPOOF_SUSPECTED` are weak; a weak-only observation is capped below the review
   threshold regardless of future weight edits. This implements the T15/T16 rule that VPN usage
   alone must verify, not blanket-reject.

### Database enforcement

Application code is not trusted to keep these invariants:

- **Evidence-bound score.** A deferrable constraint trigger checks at `COMMIT` that
  `score = LEAST(100, SUM(signal weights))` and `band = gs_risk_band(score)`. A case cannot be
  presented to a reviewer with a score its recorded evidence does not support.
- **Append-only evidence and reviews.** `RiskSignal` and `RiskCaseReview` reject `UPDATE` and
  `DELETE`; grants also revoke those privileges.
- **Independent review.** The resolver must equal the current actor, must not be the subject,
  and must not be the human who opened the case. System-opened cases (`openedByUserId IS NULL`)
  may be resolved by any authorised reviewer.
- **Review record required.** A terminal transition requires a matching `RiskCaseReview` row
  with the same version, reason and decision, plus a reason of at least 8 characters.
- **Explicit state machine.** `OPEN`/`UNDER_REVIEW` may rescore in place or move to a terminal
  `CLEARED`/`CONFIRMED_FRAUD`. Terminal cases are frozen: no new evidence, no re-decision, no
  identity or country change.
- **Privileged-only, RLS-forced.** All three tables use `FORCE ROW LEVEL SECURITY` with a
  `gs_is_super()` policy; the runtime role sees nothing.
- **Audit and outbox.** A resolution writes one `AuditLog` row and one idempotent
  `risk.case.resolved` outbox event keyed by case and version.

### Why there are three migrations

`0066` was applied to the isolated test database before integration testing exposed two defects.
Applied migrations stay frozen, so the fixes are additive, following the existing project
practice (0035/0036, 0060, 0062/0063):

- `0067`: `AuditLog`'s actor column is `actorId`, and an evidence rescore must be allowed to keep
  the current non-terminal status.
- `0068`: `ActorType` has no `ADMIN` member; a human reviewer is audited as `USER`.

A clean database applying `0066` → `0067` → `0068` reaches exactly the state the tests verify.

## Explicitly not in this slice

- No admin/vendor/customer HTTP endpoints and no OpenAPI operations yet. The next slice adds the
  scoped, step-up-gated review API and its contract.
- No signal producers are wired into checkout, payment or OTP flows; nothing scores live traffic.
- No appeal workflow, no case assignment/SLA, no cross-case velocity aggregation.
- No AI involvement. A risk score is not an AI decision and grants no authority; AI still cannot
  approve KYC, refunds, payouts, permission changes or ledger edits.
- `CONFIRMED_FRAUD` records a human finding only. It does not suspend an account, reverse money,
  or alter any ledger. Enforcement, if ever approved, needs its own audited, reversible design.

## Verification

Run on the isolated test database (`getstoopy_foundation_test`), migrations `0001`–`0068`:

- Unit: `packages/core/test/fraud-risk.test.ts` — 7 tests.
- Integration: `tests/integration/fraud-risk.test.ts` — 8 tests covering runtime-role denial,
  self-open denial, actor mismatch, evidence/score mismatch rejection, append-only evidence,
  independent and self-review denial, missing review record, terminal freezing, audit/outbox
  emission, and the absence of any permission grant or extra audit side effect.

Full gate results and CI evidence are recorded in `docs/15-progress-and-decisions.md`.
