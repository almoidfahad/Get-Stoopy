# KYC, privileged enrollment and verification workflow

**Status:** proposed policy, with a partial executable foundation. No real identity documents have been collected; no government verification is connected. The implemented user-level KYC case/review state machine, storage linkage, scoped step-up review, idempotent decisions and fail-closed eligibility helper are documented in `27-kyc-case-foundation.md`. Vendor/rider party profiles and privileged KYC-gated activation are documented in `28-party-profiles-activation.md`. Admin activation, checklist policy engine, delegated local scope, retention automation and provider verification remain pending.

## Common lifecycle

`DRAFT → SUBMITTED → SCAN_PENDING → UNDER_REVIEW → MORE_INFORMATION / APPROVED / REJECTED`; later `EXPIRING → RESTRICTED → RENEWAL_REVIEW`. Account suspension is a separate status. Document status and overall case status are separate; one approved passport does not approve an entire company.

1. Authenticated applicant selects role and country; server issues the exact required/conditional checklist from a versioned policy.
2. Applicant gives consent; direct upload goes to private quarantine through an authorized short-lived upload session. An authorized office may assist upload, recording subject consent and uploader.
3. Validate MIME/magic bytes, size/pages/dimensions, malware and document completeness; strip unnecessary metadata and encrypt. Store checksum, issuer, expiry, classification and restricted object key.
4. Assign a scoped reviewer. Reviewer sees minimum data, masked identifiers by default and a short-lived download; every view/export is audited.
5. Record per-document decision, reasons, evidence and method: `MANUAL_DOCUMENT_REVIEW`, `AUTHORIZED_PROVIDER`, `AUTHORIZED_OFFICIAL_CHANNEL` or `IN_PERSON`. Never claim official database verification without actual evidence.
6. Approve the case only when all required checks pass. Applicant cannot approve self; reviewer/uploader separation is enforced where practical. High-risk staff/finance grants use maker–checker.
7. Emit status event, notify applicant, revalidate eligibility at selling/shift-start/offer-acceptance/privileged access. Approval is not a permanent bypass.
8. Expiry reminders (proposed 30/14/7 days, configurable), renewal grace only where policy permits, restrict new selling/delivery/privileged work when mandatory evidence expires. Existing deliveries finish safely; financial history remains.
9. Rejection/resubmission preserves prior versions. Retention/deletion follows an approved schedule with legal-hold exceptions and storage/cache cleanup.

## Vendor checklist

| Category | Individual / sole proprietor | Company / authorized representative |
|---|---|---|
| Identity | NID or passport where permitted; contact verification | Representative NID/passport; authorization letter/board resolution |
| Business | Valid trade license where applicable; business address | Incorporation/registration and trade license as applicable; registered address |
| Tax | TIN/BIN/VAT only where legally applicable | Company TIN/BIN/VAT as applicable; do not demand nonexistent documents |
| Store | Pickup address, store photos, operating hours | Each branch address, pickup contact and photos |
| Financial | Verified owner/business MFS/bank destination | Verified company destination; beneficiary must match approved policy |
| Regulated goods | Category-specific permits before publication | Same; legal review before enabling category |

Passport is not mandatory for every vendor when an accepted NID path exists. Business type controls documents. Commission/subscription settings do not replace KYC.

## Rider checklist

Identity (NID/passport as permitted), phone/contact, address, emergency contact with appropriate consent, profile photo if required, vehicle type. Bicycle: no motor driving license/registration demand. Motorbike/car: applicable driving license, registration, fitness/tax token/insurance where required. Vehicle ownership or authorization evidence where policy requires. Verify payout destination separately. Rider cannot accept offers while pending/rejected/expired or outside authorized zones.

## Admin checklist and bootstrap

No public admin registration. Authorized invitation specifies role and descendant scope; candidate completes identity/KYC, secure credential setup and TOTP before activation. Sensitive roles receive additional checks. Initial Super Admin bootstrap is an offline two-person ceremony with unique accounts, recovery custody and documented emergency access—not a shared hardcoded password.

Enrollment flow: identity challenge → authenticator QR/secret shown once over secure session → verify current TOTP → issue single-use recovery codes once → activate account → security notification. Store TOTP secrets only in the identity provider's protected credential store. Test Google Authenticator-compatible time-step/algorithm settings against the selected pinned provider version; a feature list is not an interoperability test.

Every privileged login requires password + TOTP. New/suspicious device triggers additional email verification; the final master's risk-based policy supersedes the earlier suggestion to email a code on every login. Step-up is repeated for scope grants, KYC approval, payout/refund approval, destination changes, exports and emergency actions. Recovery requires identity proof, single-use code consumption, notification and session review; support cannot read or reuse recovery codes. Lost-device recovery must not silently remove MFA.

## Access, retention and test gates

- KYC bucket denies anonymous access and search indexing. Signed access is reviewer/object/purpose-specific, proposed 60-second TTL; prefer a no-store proxy when supported.
- Logs contain case/document IDs, not full NID/passport/bank numbers. Review UI watermarks identify session/scope; browser capture prevention is not promised.
- Proposed retention targets pending owner/legal approval: rejected/unneeded uploads shortest feasible; raw verification evidence only as required; financial records according to applicable law; deletion jobs verify object and derivative removal. Do not invent a statutory period from the historical chat.
- Test unauthorized reviewer, cross-scope admin, expired URL, public object access, malicious upload, duplicate callback/upload, self-approval, expired document, renewal, lost authenticator, office-assisted consent and emergency revocation.

Official identity-provider documentation describes TOTP enrollment and account-linking flows; automatic linking to a same-email local account is explicitly a security risk. Disable unsafe email-only linking and require authenticated proof-based linking. [1](https://www.keycloak.org/docs/latest/server_admin/index.html) [4](https://github.com/keycloak/keycloak/blob/main/docs/documentation/server_admin/topics/identity-broker/first-login-flow.adoc)
