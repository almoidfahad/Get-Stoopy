# KYC case foundation and review state machine

Status: **implemented and locally integration-tested on an isolated PostgreSQL test fixture.** This is a user-level KYC case/review foundation, not a completed vendor/rider/admin onboarding product, not an official identity-verification integration, and not a role grant.

## Problem

Before this slice, KYC existed only as private storage objects with a storage-level quarantine review. There was no persistent KYC case, no explicit case state machine, no applicant/reviewer separation, no case-level idempotent decision, no expiry-aware eligibility helper, and no database guard preventing approval without review evidence.

## Change

Migrations:

- `0012_kyc_case_foundation`
- `0013_kyc_approval_hardening`

New executable models:

- `KycCase`: subject user, subject type (`VENDOR`, `RIDER`, `ADMIN`), country anchor, policy/consent versions, explicit status, optimistic version, submission/review/expiry timestamps.
- `KycDocument`: append-only link from a case to an already storage-reviewed private `StorageObject`, with document type, content-hash snapshot and optional document expiry.
- `KycReview`: append-only human decision with reviewer, command key, payload hash, from/to status, reason and verification method.

New API module: `apps/api/src/kyc`.

New core helpers: `packages/core/src/kyc.ts` exports the explicit transition map, `assertKycTransition`, `kycDecisionTarget`, `isKycEligible` and `assertKycEligible`.

## State machine

Applicant transitions:

```text
DRAFT -> SUBMITTED
MORE_INFORMATION -> SUBMITTED
```

Reviewer transitions:

```text
SUBMITTED -> UNDER_REVIEW
UNDER_REVIEW -> APPROVED | REJECTED | MORE_INFORMATION
APPROVED -> REVOKED
```

Terminal states in this slice: `REJECTED`, `REVOKED`. Renewal after terminal/expired approval is a new case; historical cases/reviews/documents are not deleted.

Approval is fail-closed:

- requires a future case `expiresAt`;
- requires at least one linked document;
- requires linked evidence to be `UPLOADED`, magic-valid, not deleted, hash-matched and unexpired;
- requires an append-only `KycReview` row in the same transaction;
- denies self-review at API and database layers.

`isKycEligible` returns true only for a matching subject type with `APPROVED` status and unexpired `expiresAt`. It is a helper for future selling/shift/privileged-access commands; it does not grant a role, scope, vendor membership or rider eligibility by itself.

## HTTP interface

All endpoints are under `/api/v1/kyc` and require an opaque session. Mutations also require CSRF/origin checks.

| Method | Path | Purpose |
|---|---|---|
| POST | `/cases` | Create own `VENDOR` or `RIDER` draft case with explicit consent. `ADMIN` self-service is rejected. |
| GET | `/cases/:id` | Read own case, document metadata and review history. |
| POST | `/cases/:id/documents` | Link an owned, storage-reviewed KYC object to an editable case. |
| POST | `/cases/:id/submit` | Submit draft/more-information case with optimistic version. |
| GET | `/eligibility?subjectType=&countryId=` | Fail-closed self eligibility check. |
| GET | `/admin/cases?countryId=&status=&limit=&cursor=` | Scoped reviewer queue. |
| POST | `/admin/cases/:id/decision` | Idempotent human review decision. |
| POST | `/cases/:id/documents/:documentId/access` | Scoped reviewer short-lived document access token. |

Review authorization requires:

1. `kyc:case:review` permission;
2. recent `STEP_UP` assurance;
3. active geographic scope containing the case country anchor;
4. reviewer is not the subject.

This slice deliberately supports only a country-level KYC scope anchor. City/zone-delegated KYC review is **not** enabled until vendor/rider address/operational-area anchors exist. A reviewer with only city/zone scope cannot read or decide a country-anchored case.

## Idempotency and concurrency

- Case creation returns the existing open case when subject/type/country/policy/consent match; a different open-case payload conflicts.
- A partial unique index allows only one open case (`DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `MORE_INFORMATION`) per subject/type/country.
- Document linking is idempotent by unique `storageObjectId` for the same case.
- Review decisions require `commandKey` and optimistic `version`.
- Same case + same `commandKey` + same payload hash returns the original review as `duplicate: true`.
- Same case + same `commandKey` + different payload returns `KYC_IDEMPOTENCY_CONFLICT`.
- Stale version returns `KYC_VERSION_CONFLICT`.
- Case rows are locked with `SELECT ... FOR UPDATE` during submit/link/decision transactions.
- Case, document and review writes emit audit records; case lifecycle transitions emit outbox events (`kyc.case.created`, `kyc.case.submitted`, `kyc.case.reviewed`).

## Database and storage guards

- Runtime role has SELECT-only access to KYC tables, subject to RLS own-case policies.
- Privileged role has INSERT/SELECT on append-only document/review tables and INSERT/SELECT/UPDATE on cases; DELETE is revoked.
- RLS is enabled and forced on all KYC tables.
- `gs_kyc_case_guard` enforces immutable identity/policy/consent fields, version increment, explicit transitions, review-row requirement, submission document requirement and approval evidence/expiry checks.
- `gs_kyc_document_guard` requires editable case status, subject-owned link, KYC purpose, storage-reviewed `UPLOADED` object, magic validation and hash match.
- `gs_kyc_review_guard` denies self-review and from-status mismatch.
- `KycDocument` and `KycReview` have append-only UPDATE/DELETE triggers.
- `gs_guard_kyc_linked_storage` prevents silent deletion/downgrade/identity change of storage objects already linked as KYC evidence.
- Reviewer document access issues a 60-second storage download token and writes a sensitive-read audit record. It does not expose public object URLs.

## Seed and permission boundary

`scripts/seed-local.ts` now separates permission definitions and role assignments:

- `country_admin` receives only base administrative permissions.
- `kyc_reviewer` receives `storage:kyc:review` and `kyc:case:review`, but no user is assigned automatically.
- `finance_ledger` receives ledger primitive permissions, but no user is assigned automatically.

No admin identity, password, TOTP secret or government identity data is fabricated. If an older local database was seeded before this change, review existing `country_admin` role permissions manually; the new seed does not grant sensitive reviewer/finance permissions to that role.

## Safety and rollout boundary

- Migrations were applied only to isolated local test database `getstoopy_foundation_test`.
- No development or production database was migrated in this step.
- No real identity document, government verification, vendor activation, rider activation, admin provisioning, payment or payout was executed.
- The slice is additive; existing rows are not rewritten.
- Before applying to any existing non-test database, review DDL lock/trigger behavior and obtain explicit confirmation.
- Rollback plan: stop KYC API writes, deploy previous code, then drop KYC triggers/functions/tables/types and the linked-storage guard in a reviewed down migration. Do not drop KYC tables while new code is running.

## Verification actually run

| Check | Result | Boundary |
|---|---|---|
| `npm run db:format` | PASS | Prisma schema formatted |
| `npm run db:generate` | PASS | Prisma client generated |
| `npm run db:migrate` | PASS | `0012` and `0013` applied to isolated test DB only |
| grant script | PASS | isolated test DB only |
| `npm run db:validate` | PASS | Prisma schema valid |
| `npm run build:packages` | PASS | shared packages compile |
| `npm run typecheck` | PASS | packages, API, worker, web |
| `npm test` | **92 tests / 15 files PASS** | includes KYC state-machine/eligibility unit tests |
| `npm run test:integration` | **52 tests / 9 files PASS** | includes real PostgreSQL KYC API/RLS/trigger/idempotency tests |
| `npm run build:api` | PASS | API compiles |
| `npm run build:worker` | PASS | worker compiles |
| `python tools/validate_design_artifacts.py` | **10 passed / 0 failed** | design artifacts only, not application/security certification |

Integration tests cover:

- vendor lifecycle: create, link, submit, start review, approve, eligibility, reviewer queue, document access, audit and outbox;
- permission, step-up, cross-country scope and self-review denial;
- ADMIN self-service rejection and consent requirement;
- review command deduplication, payload conflict, stale version and skipped transition rejection;
- more-information resubmission, future-expiry requirement, revocation and preserved history;
- quarantined/pending/foreign/non-KYC evidence rejection and expired-document approval denial;
- database append-only, review-required, self-review and linked-storage guards;
- runtime RLS isolation and foreign-case hiding.

## Still pending

- Versioned country/business/rider/admin document checklist policy engine and conditional requirements.
- Vendor/rider/admin domain profiles, invitation/provisioning, membership resolution and activation gates that consume KYC eligibility.
- City/zone/regional delegated KYC scope after address/operational-area anchors exist.
- Office-assisted upload with recorded consent, maker-checker for high-risk staff, assigned-reviewer queues and SLA alerts.
- Scheduled expiry/renewal reminders, `EXPIRING`/`RESTRICTED` operational states, retention/legal-hold and secure deletion jobs.
- Authorized provider/official-channel verification methods; this slice only implements `MANUAL_DOCUMENT_REVIEW`.
- Production object store/KMS/AV, reviewer UI watermarks, notification adapters and performance/load testing.
