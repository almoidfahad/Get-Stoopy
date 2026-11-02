# Phase 2 — Privileged security, recovery/session controls and private storage

Status: **IN PROGRESS — security + private-storage slice implemented and integration-tested locally.** This is not production authorization and not the full marketplace.

## Implemented

### TOTP enrollment and step-up
- `UserMfa` stores an AES-256-GCM encrypted TOTP secret envelope; plaintext secrets are returned only during enrollment.
- RFC 6238-style TOTP verification with replay protection (`lastUsedCounter`), bounded attempt rate limits and audit records.
- Enrollment confirmation activates MFA and issues one-time-display recovery codes; only SHA-256 hashes are stored.
- Step-up raises the current session to `STEP_UP` for 10 minutes; expired step-up is downgraded during session resolution.
- Admin example endpoint now requires both MFA and recent step-up.

### Safe OAuth account linking
- Login still refuses automatic email-based linking (`ACCOUNT_LINKING_REQUIRED`).
- BFF link flow uses a separate encrypted OIDC transaction (`purpose=link`) and callback.
- API linking verifies the provider ID token, rejects identities already owned by another account, and requires step-up for admin permission holders.

### Recovery, device and session management
- Active session listing, single-session revocation and revoke-other-sessions.
- Recovery-code regeneration requires recent step-up and revokes previous unused codes.
- Session schema now includes device label, IP/UA hashes, step-up expiry and revocation reason.

### Emergency revocation drill
- Privileged endpoint requires `security:session:revoke`, recent step-up and an incident reason.
- Revokes target sessions, increments `authorizationVersion`, writes audit and emits `security.user.revoked` outbox event.
- Integration test proves the target session becomes 401 after revocation.

### Private storage interface
- `packages/storage` defines an `ObjectStorage` interface and a local encrypted adapter for development.
- `StorageObject` metadata is RLS-protected; uploads/downloads use short-lived HMAC tokens.
- Purpose/content-type allowlists, size limits, SHA-256 integrity, no-store download responses and audit records.
- Local adapter is **not** a production object store; S3-compatible/MinIO adapter, KMS, AV scanning and retention jobs remain pending.

## Verification actually run

| Check | Result | Boundary |
|---|---|---|
| Unit tests | PASS | TOTP/base32/replay, storage encryption/token tests |
| Security integration | PASS | enrollment → confirm → step-up → recovery → session controls → emergency revocation |
| Storage integration | PASS | encrypted upload/download, owner isolation, bad token, type/size validation |
| Full local integration suite | PASS | PostgreSQL/PostGIS + Redis + API + worker/outbox/inbox + security + storage |

## 2026-11-02 storage hardening addendum

KYC uploads now pass server-side magic-byte validation and enter `QUARANTINED` until a privileged, step-up reviewer approves or rejects them. Self-review is denied, review decisions are audited, and a database trigger prevents runtime owners from rewriting review metadata or self-approving KYC objects. See `25-storage-quarantine-review.md`. Malware scanning, production object storage/KMS and full KYC case management remain pending.

## Still not proven / pending
- Keycloak-side mandatory admin TOTP policy and production IdP hardening.
- Real Google/Facebook/LinkedIn/X broker configuration and provider-specific linking tests.
- Device trust/risk scoring, WebAuthn, push notification delivery and account-recovery helpdesk workflow.
- Production object storage, KMS key rotation, malware scanning, retention/legal hold and backup restore.
- Full commerce, finance, KYC review, delivery dispatch and settlement modules.
