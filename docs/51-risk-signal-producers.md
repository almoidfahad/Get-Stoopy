# Phase 3 — Deterministic risk-signal producers

Status: **implemented and integration-tested against the isolated local test database.**
Builds on docs 49 (foundation) and docs 50 (review API). This slice wires trusted backend facts
into append-only risk evidence. It adds **no public risk endpoint**, no AI, no automated
enforcement, and no production/live-payment change.

## Feature flag

`RISK_SIGNAL_PRODUCERS_ENABLED` defaults to `false`. It may be enabled only in development/test;
`loadEnv`/`loadApiEnv` reject `true` when `NODE_ENV=production`
(`RISK_SIGNAL_PRODUCERS_NOT_AUTHORIZED`). The integration suites for producers and delivery OTP
enable it explicitly. When disabled, the producer methods return without writing evidence.

## Producers

All producers run inside the existing privileged transaction of the source command. They derive
country and subject from persisted server-side rows, never from client-supplied risk fields.

| Source | Signal | Window | Threshold | Subject | Case kind |
| --- | --- | --- | --- | --- | --- |
| Order created from checkout quote | `VELOCITY_ORDERS_HIGH` | 10 min | 6 orders | Buyer | `ORDER_ABUSE` |
| Applied signed sandbox webhook `FAILED` | `PAYMENT_FAILED_BURST` | 15 min | 3 distinct orders | Buyer | `PAYMENT_ABUSE` |
| Delivery OTP wrong-code attempt | `OTP_ABUSE_PATTERN` | 15 min | 4 `INVALID` attempts | Rider who submitted the attempt | `ACCOUNT_ABUSE` |

Safety rules:

- **No enforcement.** Producers only append `RiskCase`/`RiskSignal` evidence, audit and outbox.
  They never change order lifecycle, payment status, OTP challenge state, account status,
  permissions or ledgers. Every summary carries `automatedEnforcement: false`.
- **Verified payment facts only.** Rejected amount/currency webhooks, unsigned webhooks,
  `UNKNOWN`, out-of-order replays and duplicate webhook deliveries do not create failure evidence.
- **OTP attribution is narrow.** Only actual wrong-code `INVALID` attempts count. Locked/expired
  replays and valid OTPs do not. The subject is the authenticated rider who submitted the attempt,
  not the buyer/recipient. No OTP code, phone number or recipient plaintext is stored in evidence.
- **Country and subject isolation.** Window counts are scoped by country and subject. An actor in
  one country cannot accumulate evidence against a subject in another country.
- **Idempotent daily case key.** `RiskCase.producerKey` is a unique, immutable key:
  `risk-v1:<kind>:<countryId>:<subjectUserId>:<UTC day>`. A same-day repeat of the same signal
  does not inflate score or open a duplicate case. Terminal cases are never reopened; a later
  UTC day can open a new case if the pattern recurs.
- **Concurrency.** A transaction advisory lock keyed by the same producer key is taken before
  counting, so simultaneous threshold crossings cannot miss or duplicate the first evidence.
- **Aggregate evidence only.** `RiskSignal.summary` stores producer policy version, source type,
  window, threshold, observed count and `automatedEnforcement: false`. `evidenceHash` binds the
  sorted source IDs and summary; raw source IDs are not exposed by the review API.

## Schema and contract

Additive migration `0069_risk_signal_producers`:

- `RiskCase.producerKey` nullable unique, system-opened only, immutable.
- `RiskSignal.summary` nullable JSONB object for aggregate producer evidence.
- Supporting indexes on `Order`, `PaymentIntent` and `DeliveryOtpAttempt`.
- Extends the frozen `0068` case guard without editing applied migrations.

No new OpenAPI operation is added. `GET /risk/cases/{id}` now includes the aggregate `summary`
alongside each signal's code/weight/observedAt; the queue remains aggregate-only. The existing
review API and its permission/country/step-up gates are unchanged.

## Verification

- `packages/core/test/fraud-risk-producers.test.ts` — 4 unit tests for key/window helpers and
  conservative thresholds.
- `packages/config/test/env.test.ts` — producer flag default-off and production rejection.
- `tests/integration/risk-producers.test.ts` — 3 tests: checkout velocity threshold/no enforcement,
  verified sandbox payment-failure burst/idempotency, and terminal-case non-reopening.
- `tests/integration/dispatch.test.ts` — OTP lock test now asserts rider-scoped evidence, no buyer
  attribution, no OTP leakage into summary, and delivery state unchanged.

Full gate results and CI evidence are recorded in `docs/15-progress-and-decisions.md`.

## Still pending

Coupon/address/device/location/VPN producers, cross-case velocity aggregation, appeal workflow,
case assignment/SLA, notifications, and any enforcement design (which would require its own
audited, reversible, owner-approved slice). AI remains uninvolved.
