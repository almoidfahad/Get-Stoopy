# Foundation audit and dependency-ordered commerce plan

Date: 2026-11-02. Scope: repository inspection before implementing the next commerce/finance/KYC/delivery slice. This document records what is executable now, what is only designed, and the safe order for closing the gap. It does not claim marketplace completion.

## Audit method

Inspected Git state, Prisma schema/migrations, API/auth/security/storage modules, worker/events packages, database grants, CI, integration tests, architecture/ADRs and progress docs. Ran the existing unit suite, Prisma validation, typecheck and the real PostgreSQL/PostGIS + Redis integration suite against a newly created isolated test database. No development or production database was migrated in this step.

## Executable foundation now present

| Area | Evidence | Boundary |
|---|---|---|
| Monorepo/API/BFF/web shell | `apps/api`, `apps/web`, `packages/bff`, pinned npm lockfile | Not a full customer/vendor/rider/admin portal |
| Identity/session | Keycloak OIDC BFF flow, opaque revocable sessions, RLS session lookup | Real social brokers and production IdP hardening pending |
| Privileged security | TOTP enrollment/confirm/step-up, recovery codes, session controls, emergency revocation | Keycloak-side mandatory admin TOTP and helpdesk recovery pending |
| RBAC/geography | Permission checks, admin scope model, RLS negative tests | Full domain repositories and every role/scope negative test pending |
| Audit | Append-only audit table, RLS insert policy, sensitive-action audit records | Domain-wide audit coverage and export/read audit pending |
| Events/jobs | PostgreSQL outbox, BullMQ worker, transactional inbox dedupe | Full domain handlers, dead-letter UI/operations and production Redis topology pending |
| Private storage | Local AES-GCM adapter, short-lived tokens, RLS metadata, purpose/type/size checks | Production object store, KMS, AV/quarantine review, retention/legal hold pending |
| Finance primitives | Pure money/balance helpers only | No persistent immutable ledger, settlement, payout or COD reconciliation |
| State machines | Limited suborder transition helper only | Full order/payment/delivery/KYC/payout state machines pending |

At the original audit point, the executable Prisma schema had **23 models** against the Phase-1 logical design's **113 entities**. After the ledger and KYC foundation slices, the executable schema has **30 models**. There are still no executable order, vendor, product, payment, rider or delivery models; ledger persistence and user-level KYC case/review models now exist, but domain finance commands and vendor/rider/admin activation remain pending.

## Critical gaps found

1. **Outbox publish window was not crash/concurrency safe.** The old claim transaction incremented `attempts` and committed before Redis enqueue. `FOR UPDATE SKIP LOCKED` protected only the short claim transaction, not the subsequent publish window. A second publisher could reclaim the same row while the first publisher was still enqueueing.
2. **Storage is private but not yet review-safe.** Magic-byte validation, malware scanning, quarantine/reviewer workflow, production KMS and retention jobs are missing.
3. **Finance is not persistent.** `assertBalanced` and money helpers do not create immutable double-entry journals, reserves, settlements, COD custody or payout reconciliation.
4. **Authorization context is incomplete for vendors.** `SessionService.resolve()` currently returns `vendorMemberships: []`; vendor/store isolation cannot be enforced until membership resolution and scoped repositories exist.
5. **State machines are incomplete.** Only a small suborder transition map exists; payment, delivery, KYC, refund and payout transitions are not enforced.

## Dependency-ordered plan

| Order | Slice | Why it comes here | Exit gate |
|---|---|---|---|
| 1 | Outbox visibility lease + stale-worker fencing | Reliable domain events are required before order/payment/KYC side effects | Concurrent claim, crash recovery, stale-worker and retry tests pass |
| 2 | Inbox/dead-letter hardening and event operations | Failed/poison events need explicit operator handling | Duplicate, poison, dead-letter and replay tests pass |
| 3 | Storage quarantine/access/reviewer workflow | KYC documents must be private and reviewable before approval flows | Magic-byte/AV interface, reviewer authorization, retention tests |
| 4 | Immutable double-entry ledger persistence | Money effects must be balanced and immutable before payments/settlements | Journal constraints, idempotency, reserve/reconciliation tests |
| 5 | KYC domain + review states | Selling/delivery must be blocked until approval | Self-approval denial, expiry/renewal, document-access tests |
| 6 | Catalog/cart/checkout + vendor split | Commerce writes depend on identity, scope, events and ledger primitives | Remote recipient checkout, stock/price, multi-vendor split tests |
| 7 | Verified payment adapters + COD custody | Money capture/deposit must reconcile to ledger | Signed webhook, server verification, replay/tamper/refund tests |
| 8 | Rider dispatch/OTP/earnings | Delivery depends on KYC, zones, orders and ledger | Atomic assignment, 30-second offer, OTP, earnings/COD tests |
| 9 | Settlement/payout operations | Requires immutable earnings, verified destinations and reconciliation | Sunday payout, reserve, retry/unknown-result, maker-checker tests |
| 10 | Full admin/fraud/AI/QA/deployment prep | Cross-cutting hardening after domain invariants exist | Role/scope negative tests, performance budgets, restore drill, owner authorization |

## Implemented hardening slices

- Order item 1: migration `0008_outbox_visibility_lease`, durable lease/fencing columns, publisher finalization guards, worker lease configuration, unit/integration tests and operational documentation. See `23-outbox-visibility-lease.md`.
- Order item 2: migration `0009_inbox_dead_letter`, durable terminal inbox failure persistence, unrecoverable classification for invalid/unknown events, stable error codes and worker integration tests. See `24-inbox-dead-letter.md`. Operator replay/resolve API/UI remains pending.
- Order item 3: migration `0010_storage_review`, magic-byte validation, KYC quarantine, privileged step-up review, self-review denial, review-download tokens and database trigger guards. See `25-storage-quarantine-review.md`. Production AV/KMS/object store and full KYC case management remain pending.
- Order item 4: migration `0011_ledger_primitives`, immutable balanced journal persistence, business-event idempotency, currency checks, append-only triggers and privileged-only ledger grants. See `26-ledger-primitives.md`. Domain payment/COD/earnings/settlement/payout commands remain pending.
- Order item 5: migrations `0012_kyc_case_foundation` and `0013_kyc_approval_hardening`, user-level KYC case/document/review persistence, explicit state machine, scoped step-up review, self-review denial, idempotent decisions, expiry-aware eligibility helper, append-only/RLS/storage guards, audit and outbox. See `27-kyc-case-foundation.md`. Vendor/rider/admin profiles, activation gates, checklist policy engine, delegated local scope and retention automation remain pending.

No commerce or delivery domain model was added in these slices. Ledger persistence primitives and a user-level KYC case/review foundation were added; domain payment/COD/earnings/settlement/payout commands and vendor/rider/admin activation are still pending. No production deployment, live payment, paid resource or existing-data migration was performed.
