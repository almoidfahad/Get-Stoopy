# Phase 3 — Scoped fraud-risk review API

Status: **implemented and integration-tested against the isolated local test database.**
Builds on the evidence-bound foundation in docs 49. Still no automated enforcement, no signal
producers, no AI, no production, payment or payout change.

## Endpoints

All three require an active session, the `risk:case:review` permission, an in-scope country grant
and a recent step-up. Out-of-scope cases return `404`, indistinguishable from missing ones.

| Method | Path | Behaviour |
| --- | --- | --- |
| GET | `/api/v1/risk/cases?countryId=` | Open/under-review queue, max 100, **aggregate only** |
| GET | `/api/v1/risk/cases/{id}` | One case with evidence and prior reviews; **read is audited** |
| POST | `/api/v1/risk/cases/{id}/review` | Record `CLEAR` or `CONFIRM_FRAUD`, CSRF + idempotent |

Contract: `contracts/openapi.yaml` / `.json`, operations `listRiskCases`, `getRiskCase`,
`reviewRiskCase`. They carry `x-contract-status: PROPOSED_NOT_IMPLEMENTED` like every other
operation in this design-first contract; the validator enforces that marker repository-wide, so
implemented status is tracked here and in docs 15 rather than by breaking the contract gate.

## Deliberate limits

- **No creation endpoint.** Cases and signal weights come from the trusted foundation layer and
  the versioned `risk-v1` policy. A caller cannot open a case against an arbitrary user, choose a
  score, or set a weight through HTTP. A test asserts `POST /risk/cases` is `404`.
- **No enforcement.** A `CONFIRM_FRAUD` finding records a human decision only. It does not suspend
  the subject, move money, reverse a payment or grant a permission. Every response carries
  `automatedEnforcement: false`.
- **Aggregate listing.** The queue returns id, kind, status, score, band, policy version, version
  and timestamp — no subject identifier. A test asserts the subject id appears nowhere in the
  list payload.
- **Audited sensitive read.** Opening a single case exposes subject linkage, so the detail endpoint
  writes a `risk.case.read` audit row in the same transaction.
- **Database owns the invariants.** Audit and outbox rows for a resolution are written by the
  `0066`/`0067`/`0068` trigger, not by the service, so a direct SQL path cannot bypass them. The
  service must insert the matching `RiskCaseReview` before the terminal transition is accepted.

## Review semantics

- Idempotency uses the existing `UNIQUE (caseId, commandKey)` constraint. A replay with the same
  payload returns `duplicate: true`; a different payload under the same key returns
  `409 RISK_IDEMPOTENCY_CONFLICT`.
- `expectedVersion` must match; stale or terminal cases return `409 RISK_VERSION_OR_STATE`.
- Independence is enforced twice: in `assertIndependentRiskReview` and again in the database
  guard. The subject cannot review their own case, and a human opener cannot resolve it.
- Reasons must be 8–512 characters after trimming.

## Verification

`tests/integration/risk-review-api.test.ts` — 7 tests:

1. Permission, country-scope (`404`) and step-up (`403 STEP_UP_REQUIRED`) enforcement.
2. Aggregate queue with no subject leakage.
3. Audited sensitive read returning recorded evidence.
4. Self-review and non-independent reviewer denial.
5. Idempotent finding, conflict on payload change, single outbox event, subject not suspended and
   no role granted.
6. Stale version, short reason and terminal re-decision rejection.
7. No case-creation or weight-setting endpoint.

Full gate results and CI evidence are in `docs/15-progress-and-decisions.md`.

## Still pending in this area

Signal producers wired into checkout/payment/OTP, appeal workflow, case assignment and SLA,
cross-case velocity aggregation, and any enforcement design (which would need its own audited,
reversible, owner-approved slice). AI remains uninvolved.
