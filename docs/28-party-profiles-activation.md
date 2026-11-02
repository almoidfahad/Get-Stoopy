# Party profiles, vendor membership resolution and KYC-gated activation

Date: 2026-11-02. Scope: pre-commerce foundation slice after KYC case/review persistence. This slice adds executable vendor/rider party profiles, vendor membership resolution into the session authorization context, and privileged KYC-gated activation/suspension. It does **not** add catalog, cart, checkout, payments, dispatch, earnings, settlement or payout.

## Why this slice comes before catalog/checkout

Selling and delivery must be blocked until the relevant party is approved. The previous KYC slice created user-level KYC cases and an eligibility helper, but `SessionService.resolve()` still returned `vendorMemberships: []` and never set `riderId`. Commerce commands would therefore have had no reliable vendor/rider eligibility anchor. This slice closes that specific gap before product/order writes are introduced.

## Executable schema additions

Migrations:

- `0014_party_profiles_activation`
- `0015_party_kyc_insert_hardening`

New models:

| Model | Purpose | Important constraints |
|---|---|---|
| `Vendor` | Legal vendor party profile, one per owner user per country | `DRAFT` insert only; unique `(ownerUserId, countryId)`; unique `kycCaseId`; versioned transitions; immutable owner/country/identity fields |
| `VendorMembership` | Vendor-scoped staff/owner membership | Unique `(vendorId, userId)`; one `OWNER` membership per vendor; OWNER must match vendor owner; immutable vendor/user/role/grantedBy; revocation is terminal |
| `RiderProfile` | Rider party profile, one per user | `DRAFT` insert only; unique `userId`; unique `kycCaseId`; versioned transitions; immutable user/country/identity fields |

New enums:

- `PartyStatus`: `DRAFT`, `ACTIVE`, `SUSPENDED`
- `VendorMembershipRole`: `OWNER`, `MANAGER`, `STAFF`
- `RiderVehicleType`: `BICYCLE`, `MOTORBIKE`, `CAR`, `OTHER`

The executable Prisma schema now has **33 models** against the Phase-1 logical design's 113 entities. Partial indexes and trigger-enforced rules remain database-owned where Prisma cannot express them.

## Party lifecycle

Allowed transitions:

```text
DRAFT -> ACTIVE
ACTIVE -> SUSPENDED
SUSPENDED -> ACTIVE
```

Activation requires all of the following:

1. Privileged service path (`gs_privileged`, RLS super context).
2. Explicit permission: `vendor:profile:activate` or `rider:profile:activate`.
3. Recent `STEP_UP` assurance.
4. Admin geographic scope containing the party country.
5. Non-self activation: the actor cannot activate their own vendor/rider profile.
6. Expected party `version` (optimistic concurrency).
7. A linked `KycCase` that is:
   - `APPROVED`,
   - unexpired (`expiresAt > now()`),
   - for the same subject user,
   - for the same subject type (`VENDOR` or `RIDER`),
   - for the same country.
8. Activation metadata: `activatedAt`, `activatedByUserId`, `kycCaseId`.

Suspension requires permission, step-up, country scope, expected version and a reason. It does not delete history. Reactivation repeats the KYC and non-self checks.

Database triggers enforce the same core rules independently of the API:

- `gs_party_insert_guard`: party profiles must start as `DRAFT` without activation metadata.
- `gs_vendor_activation_guard` / `gs_rider_activation_guard`: privileged-only, versioned, non-self, KYC-gated transitions.
- `gs_vendor_membership_guard`: membership identity/role/grantedBy immutable; revocation terminal.
- `gs_vendor_membership_insert_guard`: memberships start unrevoked, expiry must be future, OWNER membership must match vendor owner.
- `gs_kyc_case_insert_guard`: KYC cases must be inserted as `DRAFT`; an `APPROVED` case cannot be inserted directly to bypass review.

Runtime role has `SELECT` only on party tables. Privileged role has `SELECT/INSERT/UPDATE` but no `DELETE`. RLS is forced.

## Session authorization context

`SessionService.resolve()` now resolves party context after the opaque session is validated:

- `vendorMemberships` includes only memberships that are:
  - unrevoked,
  - unexpired,
  - attached to an `ACTIVE` vendor,
  - attached to a vendor whose linked KYC case is approved, unexpired, subject-matched and country-matched.
- Each resolved membership carries `vendorId`, `countryId` and role-derived vendor-scoped permissions.
- `riderId` is set only when the rider profile is `ACTIVE` and its linked rider KYC case is approved, unexpired, subject-matched and country-matched.
- `GET /api/v1/auth/me` now exposes `vendorMemberships` and `riderId` (`null` when ineligible).

Vendor role permissions are vendor-scoped, not global RBAC permissions:

| Role | Vendor-scoped permissions |
|---|---|
| OWNER | `vendor:profile:read/write`, `vendor:membership:read/write`, `vendor:catalog:write`, `vendor:order:read/write` |
| MANAGER | `vendor:profile:read`, `vendor:membership:read`, `vendor:catalog:write`, `vendor:order:read/write` |
| STAFF | `vendor:profile:read`, `vendor:order:read` |

`packages/core/src/access.ts` now has a separate vendor-membership grant path. It can satisfy only `vendor:*` permissions when the caller explicitly opts into vendor resources, and it requires the membership country anchor to match the resource country. It cannot satisfy admin/finance/KYC permissions. Global RBAC and geographic scope remain required for non-vendor permissions.

## Implemented API surface

All writes require session + CSRF/Origin. Admin activation/suspension additionally requires permission, step-up and country scope.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/parties/vendors` | Create own vendor draft; idempotent per owner/country; creates OWNER membership |
| GET | `/api/v1/parties/vendors/me` | List own vendor profiles through runtime RLS |
| POST | `/api/v1/parties/riders` | Create own rider draft; idempotent per user |
| GET | `/api/v1/parties/riders/me` | Read own rider profile through runtime RLS |
| POST | `/api/v1/parties/admin/vendors/:id/activate` | Privileged non-self vendor activation with approved KYC |
| POST | `/api/v1/parties/admin/vendors/:id/suspend` | Privileged vendor suspension |
| POST | `/api/v1/parties/admin/riders/:id/activate` | Privileged non-self rider activation with approved KYC |
| POST | `/api/v1/parties/admin/riders/:id/suspend` | Privileged rider suspension |
| GET | `/api/v1/parties/vendors/:id/memberships` | Owner-only membership list; step-up required |
| POST | `/api/v1/parties/vendors/:id/memberships` | Owner grants MANAGER/STAFF membership; step-up required |
| POST | `/api/v1/parties/vendors/:id/memberships/:membershipId/revoke` | Owner revokes non-OWNER membership; step-up required |

Sensitive commands write append-only audit records and transactional outbox events:

- `party.vendor.created`, `party.vendor.activated`, `party.vendor.suspended`
- `party.rider.created`, `party.rider.activated`, `party.rider.suspended`
- `party.vendor.membership.granted`, `party.vendor.membership.revoked`

Outbox payloads use `schemaVersion: 1`, stable event keys and country anchors. No notification/payment/dispatch side effect is claimed.

## Seed and grants

`scripts/db-grants.sql` grants runtime SELECT-only party access, privileged SELECT/INSERT/UPDATE without DELETE, and EXECUTE on the new guard functions.

`scripts/seed-local.ts` now defines a separate `party_activation` role with:

- `vendor:profile:activate`
- `vendor:profile:suspend`
- `rider:profile:activate`
- `rider:profile:suspend`

The seed script remains idempotent and does not fabricate users or credentials. It was **not executed** in this slice. Pre-existing sensitive role assignments are not revoked by the seed; destructive cleanup requires explicit confirmation.

## Verification

Executed against isolated `getstoopy_foundation_test` only:

- Prisma format/generate/validate: PASS
- Migrations `0014` and `0015`: applied successfully to isolated test DB
- Grants re-applied: PASS
- Unit tests: **97 tests / 16 files PASS**
- Integration tests: **58 tests / 10 files PASS**
- TypeScript typecheck: PASS
- API build: PASS
- Worker build: PASS
- Design/doc validator: PASS

New integration coverage in `tests/integration/party.test.ts` verifies:

- vendor draft idempotency and OWNER membership creation,
- draft profiles absent from session memberships,
- permission/step-up/country-scope/self-activation denial,
- wrong-subject KYC denial,
- approved vendor activation and session membership resolution,
- suspension/reactivation and stale-version denial,
- MANAGER/STAFF grant/revoke/expiry resolution,
- rider activation/suspension and `riderId` session gating,
- runtime RLS isolation and privileged-only writes,
- direct `APPROVED` KYC insert denial,
- OWNER membership mismatch denial,
- fail-closed session eligibility after KYC revocation/expiry.

## Known limitations / next gates

- No store model yet; membership `storeId` remains optional in the core interface but is not resolved from a store table.
- No admin profile/KYC activation slice yet; this slice covers vendor/rider parties only.
- No catalog/product publication gate yet; future product commands must call the party eligibility helper and vendor-scoped authorization path.
- No rider shift/zone/consent/capacity gate yet; future dispatch must revalidate eligibility at shift start and offer acceptance.
- KYC checklist policy engine, expiry reminder jobs, retention automation and provider verification remain pending.
- Party activation is country-scoped; CITY/ZONE delegated activation is not enabled in this slice.
- No production deployment, live payment, paid resource or existing-data migration was performed.
