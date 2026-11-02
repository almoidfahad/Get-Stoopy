# Storage magic-byte validation, quarantine and KYC review

Status: **implemented and locally integration-tested on an isolated PostgreSQL test fixture.** This hardens the existing private local storage adapter. It is not a production object store, malware scanner or full KYC case-management system.

## Problem

The previous storage slice encrypted objects and used short-lived tokens, but it accepted any bytes whose declared content type was allowlisted. KYC documents became downloadable immediately after upload. There was no server-side magic-byte check, quarantine state transition, reviewer authorization, self-review denial or review audit trail.

## Change

Migration `0010_storage_review` adds additive `StorageObject` metadata:

- `magicValid`: server-side magic-byte validation passed. This is **not** a malware scan.
- `reviewedByUserId`, `reviewedAt`, `reviewReason`: reviewer decision metadata.
- Index `(state, createdAt)` for quarantine/review queues.
- Trigger `gs_guard_storage_review`: runtime owners cannot rewrite review metadata, self-approve KYC documents, or transition quarantined objects. Review transitions require the privileged database role plus explicit super context, which the API sets only after permission and step-up checks.

Upload behavior:

1. Purpose/content-type/size allowlists remain enforced.
2. Server validates magic bytes for PNG, JPEG, WEBP and PDF before writing the encrypted object.
3. Declared/content mismatch is rejected with `CONTENT_TYPE_MISMATCH`.
4. `kyc-document` uploads become `QUARANTINED`, not immediately downloadable by the owner.
5. `profile-avatar` uploads become `UPLOADED` after magic-byte validation; production AV/moderation is still pending.

Review behavior:

- Permission: `storage:kyc:review`.
- Requires recent `STEP_UP` assurance.
- Reviewer cannot review their own object (`SELF_REVIEW_DENIED`).
- Review decisions: `approve` -> `UPLOADED`, `reject` -> `DELETED` with `deletedAt`.
- Review requires an 8–512 character reason and writes an audit record.
- Reviewer download uses a separate short-lived `review-download` token and is only valid for quarantined KYC objects.
- Owner download remains valid only for `UPLOADED` objects.

## Safety and rollout boundary

- Migration was applied only to isolated local test database `getstoopy_foundation_test`.
- No development or production database was migrated in this step.
- Existing rows are not rewritten; new columns are nullable/defaulted. The trigger affects future updates.
- Before applying to any existing non-test database, review DDL lock/trigger behavior and obtain explicit confirmation.
- Rollback plan: stop API writes, deploy the previous storage service, drop the trigger/function and new columns/index in a reviewed down migration. Do not drop review metadata while new code is running.
- This slice does not implement antivirus scanning, production KMS, retention/legal hold, reviewer queue UI, or full KYC case states. Those remain explicit gates.

## Verification actually run

| Check | Result | Boundary |
|---|---|---|
| `npm run db:generate` | PASS | Prisma client generated |
| `npm run db:migrate` | PASS | `0010` applied to isolated test DB only |
| grant script | PASS | isolated test DB only |
| `npm run db:validate` | PASS | Prisma schema valid |
| `npm run typecheck` | PASS | packages, API, worker, web |
| `npm test` | **84 tests / 13 files PASS** | includes magic-byte unit tests |
| `npm run test:integration` | **39 tests / 7 files PASS** | includes quarantine/review/self-review/magic-mismatch API tests |

Integration tests cover:

- KYC upload becomes quarantined and owner download is blocked before approval;
- reviewer without permission is denied;
- reviewer without step-up is denied;
- reviewer can download quarantined bytes through a short-lived review token;
- approval makes the object owner-downloadable;
- self-review is denied;
- magic-byte mismatch is rejected;
- disallowed purpose/content-type and size mismatch remain rejected.

## Still pending

- Production S3-compatible object store, KMS key rotation, malware scanning and quarantine bucket isolation.
- Full KYC case/reviewer queue, expiry/renewal, retention/legal hold and appeal workflow.
- Geographic scope for reviewer queues and sensitive-read/export audit at scale.
- Product image moderation and public CDN policy.
