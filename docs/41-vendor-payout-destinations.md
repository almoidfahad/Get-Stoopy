# 41 — Encrypted vendor payout destinations and independent verification

Status: **development foundation implemented; live payout and provider beneficiary verification remain disabled.** This is the prerequisite for a later vendor settlement slice, not a settlement or transfer implementation. No bank/MFS contract, production destination, real customer account or live credential is introduced. All integration identities, documents and account numbers are synthetic and labelled TEST ONLY.

## Scope and trust boundary

A vendor owner may submit a bank or merchant-MFS destination for their own active, KYC-eligible vendor. A destination is never trusted merely because the owner entered it. Ownership proof must first pass the existing encrypted-upload, magic-byte and independent quarantine-review flow. A separate scoped finance checker records a trusted verification reference and reason before the destination becomes `VERIFIED`.

This is **manual verification**, not a claim that a bank or provider API confirmed account ownership. Institution names are free-form identifiers in this development slice; no unsupported provider list, beneficiary lookup, penny-drop or transfer capability is fabricated. A real provider integration requires its own contract, capability and security gates.

The destination is usable for a future settlement only when all of the following hold at the transaction's decision time:

- destination is `VERIFIED`, not pending/rejected/retired;
- vendor, country and currency match;
- vendor remains active with unexpired, matching KYC approval;
- the 24-hour development cooldown has elapsed;
- a later settlement service rechecks these conditions server-side.

The cooldown is a fixed, explicitly documented **development safety policy**, not an approved production business rule. It is not configurable by clients. Production duration and change-control policy remain owner decisions. Even after cooldown, `payoutEnabled=false` and `moneyMoved=false` everywhere in this slice.

## Submission and privacy

`POST /api/v1/vendors/{vendorId}/payout-destinations` requires the actual vendor owner, recent step-up and CSRF. Vendor managers/staff do not inherit financial-destination authority. The owner must already have an active KYC-approved vendor.

Input includes country/currency, `BANK` or `MERCHANT_MFS`, account holder, account number, institution, reviewed proof object and command key. Bank account format is a bounded syntactic check, not ownership verification. Merchant MFS numbers are normalized using the configured country calling code. Currency must equal the country's configured `currencyCode`; cross-border destinations are not enabled.

- Full details are encrypted with AES-256-GCM using a dedicated `PAYOUT_DESTINATION_ENCRYPTION_KEY`, separate from object-storage and session keys. A missing key fails closed with `DESTINATION_KEY_REQUIRED`.
- The database stores ciphertext, key version, a keyed fingerprint and a last-four display mask. It does not store plaintext account details.
- Account fingerprints and command hashes use domain-separated HMAC-SHA256, not an unkeyed hash vulnerable to account-number guessing.
- API responses, audit rows and outbox events contain no full account number or holder name. Reviewers receive the mask and proof reference, not decrypted details.
- Proof uses purpose `payout-destination-proof`, is quarantined on upload and cannot be self-approved by the runtime owner. Magic-byte validation is not a malware-scanning claim.
- Each proof object can be linked to only one destination. Rejected/retired history is retained.

The key is supplied through ignored environment configuration; `.env.example` contains only an empty placeholder. Generate a random 32-byte key out-of-band, encode it as 64 hexadecimal characters and store it in the deployment secret manager. Never commit it or reuse another service's key. Key rotation/re-encryption is a future operational migration, not silently performed here.

## Review, replacement and retirement

| Method | Path | Authority | Behavior |
|---|---|---|---|
| POST | `/api/v1/vendors/{vendorId}/payout-destinations` | owner + step-up + CSRF | encrypted pending submission |
| GET | `/api/v1/vendors/{vendorId}/payout-destinations` | owner + step-up | masked own history, max 100 |
| GET | `/api/v1/admin/payout-destinations?countryId=…` | `finance:payout-destination:review` + step-up + country scope | pending queue, max 100 |
| POST | `/api/v1/admin/payout-destinations/{id}/review` | same finance permission/scope/step-up, not owner/submitter + CSRF | terminal VERIFY or REJECT with reference/reason |
| POST | `/api/v1/vendors/{vendorId}/payout-destinations/{id}/retire` | owner + step-up + CSRF | retire verified destination; immediately unusable |

Review and retirement use expected versions and command-key/payload-hash idempotency. Changed replay payload is a conflict. Review is terminal; a correction requires a new submission and review. A vendor-first row lock serializes submissions/reviews/replacements.

Verifying a replacement atomically retires the previous verified destination for that vendor/currency and writes its retirement history. The replacement starts its own cooldown; there is never more than one verified destination per vendor/currency. An owner may retire a destination immediately. Rejected and retired destinations cannot be reactivated by editing rows.

## Persistence and database defenses

Additive migrations:

- `0044_payout_destination_enums`;
- `0045_vendor_payout_destinations`;
- `0046_payout_destination_currency_guard` corrects the country currency column reference while retaining every eligibility check.

New tables are `PayoutDestination` and append-only `PayoutDestinationReview`. Database guards enforce active matching vendor KYC, owner submission, independently reviewed proof, country/currency consistency, immutable encrypted identity fields, expected version increments, independent review, cooldown, valid transitions and a matching review record at COMMIT. Partial unique indexes prevent duplicate active destinations and multiple verified destinations per vendor/currency.

RLS exposes destination/history rows only to the owning vendor user or privileged service context. Runtime has no destination-write grant. Review UPDATE/DELETE and destination DELETE are revoked; triggers provide a second append-only defense. Audit/outbox writes share the domain transaction. `scripts/db-grants.sql` grants only the required guard execution and applies the revokes.

`finance:payout-destination:review` is a critical permission in the local seed. It is not granted to a generic country-admin role. The existing sensitive-document review permission `storage:kyc:review` also governs payout proof quarantine review; its name is historical and does not make proof public.

## Verification and remaining limits

Unit tests cover normalization/masking, keyed fingerprints, payload sensitivity, country/currency/KYC/status checks and cooldown boundaries. Real PostgreSQL/PostGIS + Redis integration tests cover actual encrypted proof upload/review, owner/step-up gates, ciphertext and event minimization, idempotency, duplicate destinations, foreign-user RLS, scoped independent finance review, self-review denial, concurrent review, replacement/retirement, rejection, immutable history and database bypass rejection.

Still pending: production verification/cooldown policy, institution/rail capability registry, provider beneficiary verification, key rotation, retention/deletion policy, notifications, vendor/admin UI, paginated history beyond 100 rows, settlement calculation/approval and any payout execution. The next slice may **reference** a usable destination but must not infer live transfer support from verification.

Run all gates before proceeding: `npm run db:validate`, `npm run typecheck`, `npm test`, `npm run test:integration`, and `python tools/validate_design_artifacts.py`. Commit/push and remote CI must also succeed. This document is not evidence of a complete marketplace or a live financial integration.
