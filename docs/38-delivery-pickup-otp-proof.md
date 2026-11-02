# Delivery pickup confirmation, recipient OTP proof and completion gating

Last updated: 2026-11-02.

Status: **implemented and locally integration-tested development slice**. This slice closes the operational delivery-proof gap after atomic dispatch. It does **not** enable live SMS/notification delivery, COD accounting, earnings, refunds, settlement, payout or production deployment.

## 1. Scope

Implemented:

- Buyer-set immutable recipient contact snapshot per order.
- Recipient phone normalization for the order country calling code.
- Encrypted recipient contact envelope (AES-256-GCM) and HMAC-peppered phone hash; no plaintext phone column.
- Assigned-rider pickup confirmation.
- Suborder lifecycle extension: `READY_FOR_PICKUP → FULFILLING → DELIVERED → COMPLETED`.
- Recipient OTP challenge issue/verify with database-time TTL.
- Six-digit OTP generated with Node crypto `randomInt`.
- OTP stored only as domain-separated HMAC-SHA256 hash bound to challenge ID.
- Invalid-attempt counter, max-attempt lock, resend cooldown, per-delivery issue cap and recipient/rider rate caps.
- Append-only OTP attempt records and delivery proof.
- Completion gate: prepaid requires verified payment + OTP proof; COD requires future verified COD accounting and is currently blocked.
- Assignment completion only after delivery completion; route snapshot remains immutable.
- Audit + outbox; outbox/audit/API projections never contain OTP code or plaintext recipient phone.

Explicitly disabled:

- Live SMS/email/push OTP provider.
- `DELIVERY_OTP_ENABLED=true` is rejected in production.
- Test channel is allowed only with `NODE_ENV=test` and `DELIVERY_OTP_CHANNEL=test`.
- COD completion, rider earnings/COD liability ledger, settlement/payout.

## 2. Migrations

Applied only to isolated local test DB `getstoopy_foundation_test`:

| Migration | Purpose |
|---|---|
| `0031_delivery_status_values` | Additive `VendorSuborderStatus` values: `FULFILLING`, `DELIVERED`, `COMPLETED`. |
| `0032_delivery_pickup_otp_proof` | Recipient/delivery/OTP/attempt/proof/event tables, guards, RLS, extended suborder/assignment guards. |
| `0033_delivery_assignment_update_policy` | Bounded privileged UPDATE RLS policy for assignment completion. |
| `0034_delivery_otp_attempt_guard_fix` | Allow bounded invalid-attempt counter updates while challenge remains `ISSUED`; keep dispatch offer DB-time validation tolerant of transaction scheduling. |

Executable schema now has **71 Prisma models**.

New models:

- `DeliveryRecipient`
- `Delivery`
- `DeliveryOtpChallenge`
- `DeliveryOtpAttempt`
- `DeliveryProof`
- `DeliveryEvent`

## 3. Security invariants

- Recipient contact is immutable once set and encrypted with `DELIVERY_RECIPIENT_ENCRYPTION_KEY`.
- Phone hash uses `DELIVERY_OTP_PEPPER` and a domain-separated HMAC; plaintext phone is not stored.
- OTP code hash uses HMAC-SHA256 with pepper and challenge ID; plain SHA-256 of a six-digit code is not used.
- OTP code is never returned by HTTP API, written to audit, or placed in outbox payloads.
- Test sink is in-process only and is not an HTTP endpoint.
- Only the assigned rider can confirm pickup, issue/verify OTP, or complete delivery.
- Buyer cannot verify OTP; rider cannot read recipient plaintext phone from API projections.
- One issued OTP challenge per delivery; one proof per delivery; append-only proof/attempt/event tables.
- Runtime DB role cannot read OTP challenges/attempts/events except through super-only RLS; service uses privileged role with explicit authorization.
- COD completion fails closed with `COD_ACCOUNTING_REQUIRED` until the later ledger slice provides verified accounting.

## 4. HTTP surface

All routes are under `/api/v1`, require session auth, and mutations require Origin + CSRF.

| Method | Path | Authority | Notes |
|---|---|---|---|
| POST | `/orders/:orderId/delivery-recipient` | buyer | Immutable encrypted recipient contact. |
| POST | `/riders/me/assignments/:assignmentId/pickup` | assigned rider | Creates delivery and moves suborder to `FULFILLING`. |
| GET | `/riders/me/deliveries/:deliveryId` | assigned rider | Masked phone, status, proof metadata, challenge metadata; no OTP. |
| POST | `/riders/me/deliveries/:deliveryId/otp-challenges` | assigned rider | Issue/reissue subject to cooldown/caps. |
| POST | `/riders/me/deliveries/:deliveryId/otp-challenges/:challengeId/verify` | assigned rider | Consumes attempt; valid code creates proof and marks delivered. |
| POST | `/riders/me/deliveries/:deliveryId/complete` | assigned rider | Prepaid verified + proof only; COD blocked pending accounting. |

Default development policy values:

- TTL: 300 seconds.
- Max invalid attempts: 5.
- Resend cooldown: 60 seconds.
- Max issues per delivery: 3.
- Recipient issue cap: 5 per hour.
- Rider verify cap: 10 per minute.

These are conservative development defaults, not final business-approved SLAs.

## 5. Verification

Local gates against isolated PostgreSQL/PostGIS + Redis:

- `npm test`: **136 tests / 26 files PASS**.
- `npm run test:integration`: **98 tests / 19 files PASS**.
- `npm run typecheck`: PASS.
- `npm run db:validate`: PASS.
- `npm run build:api`: PASS.
- `npm run build:worker`: PASS.

Integration coverage in `tests/integration/dispatch.test.ts` includes:

1. Pickup authorization/replay, OTP issue/verify, wrong-attempt decrement, proof creation, COD completion block, no OTP in API/outbox, append-only proof and runtime OTP isolation.
2. Verified prepaid delivery completion, assignment completion, suborder completion and idempotent replay.
3. OTP lock after max invalid attempts and resend cooldown.

## 6. Next dependency

The next safe slice is **cancellation/restock/refund**, then **rider earnings + COD liability/deposit ledger**. COD delivery completion must remain blocked until verified COD accounting exists. Financial entries must remain immutable and must not be created from OTP proof alone.
