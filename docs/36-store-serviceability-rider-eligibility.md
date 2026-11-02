# Store serviceability and rider eligibility foundation

Last updated: 2026-11-02.

Status: **implemented and locally integration-tested development slice**. This is the geographic/consent prerequisite for atomic dispatch. It is **not** rider offer/assignment, road-route matrix integration, OTP delivery proof, earnings, COD liability, settlement or production readiness.

## 1. Scope

This slice adds fail-closed store pickup/serviceability and rider eligibility primitives:

- Store pickup geometry proposal + independent privileged approval.
- Store-local weekly operating hours with overlap/bounds validation.
- Store service-area proposal per active same-city ServiceZone + independent privileged approval/suspension.
- Rider explicit location-consent versioning.
- One active rider shift per rider, bound to the consent version.
- Append-only active-shift GPS samples with accuracy/future/skew bounds.
- Privileged rider zone grants with optional expiry and immutable revocation.
- Pure eligibility helpers and an API eligibility projection.

Dispatch serviceability requires all of:

```text
Store ACTIVE
+ vendor ACTIVE and KYC-eligible
+ pickup point APPROVED
+ at least one operating-hour window
+ at least one APPROVED service area
```

Rider dispatch eligibility requires all of:

```text
Rider ACTIVE and KYC-eligible
+ active shift
+ current location consent matching shift consent version
+ unrevoked/unexpired zone grant for the target zone
+ latest active-shift location sample
+ accuracy <= 100 meters
+ recordedAt age <= 120 seconds
+ recordedAt not more than 30 seconds in the future
```

These are conservative development defaults, not final business-approved SLAs. They are centralized in `packages/core/src/serviceability.ts` and must be policy-configurable before production.

## 2. Migrations and schema

Applied only to isolated local test DB `getstoopy_foundation_test`:

| Migration | Purpose |
|---|---|
| `0027_store_serviceability_rider_eligibility` | New enums/tables, PostGIS point columns/GiST indexes, guards, RLS, helper functions and comments. |
| `0028_operating_hour_delete_guard` | Additive `CREATE OR REPLACE FUNCTION` fix so operating-hour DELETE does not reference an unassigned `NEW` record. |

Executable schema now has **60 Prisma models**.

New models:

- `StorePickupPoint`
- `StoreOperatingHour`
- `StoreServiceArea`
- `RiderShift`
- `RiderLocationConsent`
- `RiderLocationSample`
- `RiderZoneGrant`

Important database invariants:

- Pickup/service-area rows start `DRAFT`; review requires actor metadata, reason and non-self review.
- Approved pickup geometry cannot be changed by a review command.
- Service areas must reference an `ACTIVE` zone in the store's city.
- Operating hours are bounded, non-overlapping per day, and replaceable only through the privileged service path.
- Rider shifts start `ACTIVE` only with current matching consent and eligible rider KYC; one active shift per rider.
- Location samples require an active matching shift, current consent and eligible rider KYC; samples are append-only.
- Zone grants require active same-country zone, non-self grantor, future expiry if present, and immutable revocation.
- Runtime role has SELECT only through RLS; writes are privileged and guarded.

`scripts/db-grants.sql` was updated and re-run. `scripts/seed-local.ts` now defines `catalog:store:serviceability:review` and `rider:zone:grant` permission seeds; it still has not been executed.

## 3. HTTP surface

All routes are under `/api/v1`, require session auth, and mutations require Origin + CSRF.

### Store serviceability

| Method | Path | Authority | Notes |
|---|---|---|---|
| POST | `/catalog/stores/:storeId/pickup-point` | vendor `vendor:catalog:write`, store-scoped | Propose/re-propose latitude/longitude. Approved geometry cannot be replaced here. |
| GET | `/catalog/stores/:storeId/serviceability` | vendor `vendor:catalog:write`, store-scoped | Returns pickup/hours/service-area projection and `serviceable`. |
| PUT | `/catalog/stores/:storeId/operating-hours` | vendor `vendor:catalog:write`, store-scoped | Replaces weekly windows; max 21 rows; no overlap. |
| POST | `/catalog/stores/:storeId/service-areas` | vendor `vendor:catalog:write`, store-scoped | Propose active same-city zone coverage. |
| POST | `/catalog/admin/stores/:storeId/pickup-point/review` | `catalog:store:serviceability:review` + STEP_UP + country scope | APPROVE/REJECT; proposer/owner self-review denied. |
| POST | `/catalog/admin/service-areas/:serviceAreaId/review` | `catalog:store:serviceability:review` + STEP_UP + country scope | APPROVE/REJECT/SUSPEND; proposer/owner self-review denied. |

### Rider eligibility

| Method | Path | Authority | Notes |
|---|---|---|---|
| POST | `/riders/me/location-consent` | own rider profile | Explicit consent grant/withdrawal with version. |
| POST | `/riders/me/shifts` | active KYC-eligible rider | Start shift with current consent version. |
| POST | `/riders/me/shifts/:shiftId/end` | own active shift | End shift; idempotent if already ended. |
| POST | `/riders/me/location-samples` | own active shift + consent | Append-only GPS sample. |
| GET | `/riders/me/eligibility?serviceZoneId=...` | own rider profile | Returns `eligible` and fail-closed reason codes. |
| POST | `/admin/riders/:riderId/zone-grants` | `rider:zone:grant` + STEP_UP + country scope | Non-self grant; optional future expiry. |
| POST | `/admin/rider-zone-grants/:grantId/revoke` | `rider:zone:grant` + STEP_UP + country scope | Immutable revocation. |

Foreign store access returns 404. Rider location samples are visible only to the rider/super through RLS. Withdrawn consent blocks new samples and new shifts; existing active shift is not silently deleted.

## 4. Core helpers

- `packages/core/src/serviceability.ts`: coordinate/hour validation, local open-window check, store dispatch-serviceability predicate, location freshness/accuracy constants.
- `packages/core/src/rider.ts`: rider KYC eligibility and dispatch-eligibility reason codes.

Reason codes include:

- `RIDER_KYC_REQUIRED`
- `RIDER_SHIFT_REQUIRED`
- `RIDER_LOCATION_CONSENT_REQUIRED`
- `RIDER_CONSENT_VERSION_MISMATCH`
- `RIDER_ZONE_GRANT_REQUIRED`
- `RIDER_LOCATION_REQUIRED`
- `RIDER_LOCATION_ACCURACY`
- `RIDER_LOCATION_STALE`
- `RIDER_LOCATION_FUTURE`

## 5. Verification

Local gates against isolated PostgreSQL/PostGIS + Redis:

- `npm test`: **128 tests / 24 files PASS**.
- `npm run test:integration`: **92 tests / 18 files PASS**.
- `npm run typecheck`: PASS.
- `npm run db:validate`: PASS.
- `npm run build:api`: PASS.
- `npm run build:worker`: PASS.
- `python tools/validate_design_artifacts.py`: document/contract validation only.

New integration suite: `tests/integration/serviceability.test.ts` covers:

1. Store serviceability remains false until pickup, hours and service area are approved; self/stranger review denial; suspension makes store unserviceable.
2. Operating-hour validation, invalid coordinates, append-only location samples and runtime zone-grant write denial.
3. Rider eligibility gating on consent, shift, zone grant, accuracy and revocation; ended shift blocks samples.
4. Withdrawn consent blocks samples; foreign rider cannot use another rider's shift; runtime RLS hides another rider's samples.

## 6. Explicit limitations

- No dispatch run, rider offer, 30-second acceptance, assignment, pickup/OTP proof or delivery completion.
- No road-route matrix provider call; no straight-line fallback is authorized for dispatch ranking.
- No automatic neighboring-zone override UI; grants are explicit privileged commands.
- No location-retention purge job, spoof-detection model or device-integrity integration.
- No store timezone-aware open/closed checkout enforcement yet; hours are stored as local weekly windows and exposed for the next slice.
- No production deployment, live payment, paid maps resource or dev/prod migration.

## 7. Next dependency

The next safe slice is **atomic dispatch offer/assignment foundation**:

1. Dispatch run for a `READY_FOR_PICKUP` suborder.
2. Candidate filtering using active shift/consent/zone grant/fresh location and store serviceability.
3. Road-route matrix adapter interface; disabled/fail-closed until provider credentials and budget are approved.
4. One unexpired 30-second offer per dispatch run, DB-time expiry, atomic acceptance, single active assignment and escalation.
5. Pickup/recipient OTP proof and earnings/COD liability only after assignment/delivery invariants exist.
