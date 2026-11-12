# 44 — Admin activation and KYC retention automation

Status: implemented in development; production enablement requires owner/legal sign-off.

## Admin activation
- No public admin registration. An authorized inviter creates a time-bounded `AdminActivation` for an existing active user and a non-bootstrap role.
- The candidate completes an `ADMIN` KYC case (only possible with a pending invitation), enrolls active TOTP, and has a linked identity.
- A different checker with `admin:activation:review`, country scope and recent step-up activates or rejects. Activation grants a time-bounded `UserRole` and COUNTRY `AdminScope` whose expiry is the earlier of invitation and KYC expiry, and bumps authorization version.
- Database guards enforce maker/checker separation, immutable invitation fields, KYC/MFA/identity evidence and deferred grant consistency. Revoked/expired ADMIN KYC closes the activation and revokes its exact grants.

## KYC retention
- `KycRetentionPolicy` is versioned, country + subject scoped, and requires an explicit `legalBasis`. Day counts are owner-approved data; no statutory default is invented. `0` days means immediate eligibility after terminal decision.
- New policy versions retire the previous active row; existing cases keep their policy snapshot.
- Approved cases past `expiresAt` transition to `EXPIRED`; linked ACTIVE vendor/rider profiles become `RESTRICTED`. Selling/dispatch eligibility already fails closed on non-approved or expired KYC.
- Renewal uses a new KYC case and the normal independent party activation command from `RESTRICTED` to `ACTIVE`.
- Reminder and expiry events are written to the outbox with deterministic keys.

## Legal hold and deletion
- A legal hold blocks deletion requests, approval and purge. Release requires a reason and is audited.
- Deletion is maker–checker: requester prepares only after `retentionDueAt`; a different reviewer approves/rejects. Active linked parties block purge.
- The worker (`KYC_RETENTION_ENABLED=true`, privileged DB + storage key) can expire KYC and restrict linked parties, but external object purge is now **test-only**; see `docs/177-kyc-purge-test-only.md`. In tests it deletes encrypted objects, tombstones `StorageObject`, marks the request `PURGED`, and appends retention/audit events. A database rollback cannot restore objects already deleted, including on a partial failure. Privileged context is transaction-local.
- Database triggers prevent unapproved linked-storage mutation/deletion.

## Operations
- API: `POST /kyc/admin/retention-tick` (country-scoped, permission `kyc:retention:manage`, step-up).
- Worker loop: `KYC_RETENTION_ENABLED`, `KYC_RETENTION_POLL_MS`, `KYC_RETENTION_BATCH_SIZE`.
- Migrations 0056–0065. Grants in `scripts/db-grants.sql`. Permissions seeded for development super admin only. See `docs/45-admin-kyc-remediation.md` for post-review fixes.
- Live payments, payouts and production deployment remain disabled and separately authorized.
