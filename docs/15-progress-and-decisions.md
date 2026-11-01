# Progress, decisions and review blockers

Last updated: 2026-11-01.

## Actual progress

- Repository/workspace inspected: no application or Git repository found.
- Six current reference images inspected and inventoried; hashes recorded.
- Public conversation recovered: 460 visible messages; all 209 user messages and 251 assistant replies reviewed. Unavailable artifacts disclosed.
- Normalized master and Bengali instruction saved; atomic requirement register generated.
- Architecture, logical data model/dictionary/ERD, permission/geographic policy, API contract, threat model, finance/delivery, KYC, payment readiness, AI/privacy and roadmap prepared for review.
- Documentation artifacts pass 10/10 document/contract checks; see `16-validation-report.md`. No application tests have run.
- **Phase-2 first foundation slice now exists:** TypeScript core/auth/config/observability packages, brand tokens, Prisma foundation schema/migration, Docker/CI templates and 58 passing unit tests. No running marketplace backend, live integration, paid resource or production deployment exists. See `17-phase2-foundation.md`.
- **Phase 1 architecture approved by owner on 2026-11-01 for development only, including the proposed Keycloak identity model. Phase 2 started. Paid resources, live payment collection and production deployment remain unauthorized. Phases 3–11 not started.**

## Decisions retained from the user

| Decision | Status |
|---|---|
| Get Stoopy; Shop Smart. Live Better.; approved red/white/black design | Retained; exact vector asset/rights pending |
| One modular backend/database, role portals, API-first | Retained |
| Bangladesh first; Mymensingh City and Purbadhala pilot discussion | Retained; exact active polygons/stores pending |
| Remote buyer/recipient separation | Retained; supersedes buyer-GPS matching |
| Vendor manual ready; sequential 30-second rider offers | Retained |
| Fixed admin-configured road-distance pay; no traffic/wait bonus | Retained; actual rates/cutoff pending |
| Sunday automatic payout default + manual/verified bank option | Retained; supported rail/contract pending |
| COD custody independent of earnings | Retained; explicit offset policy pending |
| Vendor/rider/admin KYC; privileged TOTP | Retained |
| Consented first-party personalization; no covert communications access | Retained |
| AI cannot execute sensitive financial/permission/KYC actions | Retained |
| No paid resources/live collection/production without approval | Standing constraint |

## Proposed choices needing architecture review

| ID | Proposal | Alternative / consequence |
|---|---|---|
| D01 | Next.js BFF + NestJS modular monolith + worker | Well-structured Next backend is permitted; Nest adds explicit domain/guard structure and another deployable |
| D02 | Keycloak identity + opaque revocable BFF sessions | Maintained database-session auth framework if owner rejects identity-service operations; no JWT-only shortcut |
| D03 | PostgreSQL/PostGIS + Prisma with reviewed spatial adapter | Pin a compatible release after Phase-2 compatibility spike; Prisma 8 extension is new, not assumed production-proven |
| D04 | Google Routes/Matrix candidate | Another road-routing provider can be selected; no straight-line substitute for required road pay/dispatch |
| D05 | Private S3-compatible storage + KMS | Managed equivalent acceptable after access/retention/encryption review |
| D06 | Double-entry immutable journals; role ledger views | Avoids competing mutable wallets; requires deferred balance constraints and reconciliation |
| D07 | Earnings route/rate snapshot at final acceptance | Offer-time snapshot is an explicit business alternative; no retroactive changes either way |
| D08 | Destination-scoped local operations; separate financial-scope anchor | Owner must approve cross-zone report visibility and vendor finance anchor |
| D09 | Mobile-first PWA initially | Native wrapper later for supported background/capture controls; honest browser limitations |
| D10 | White/black/red tokens and approved layout | Exact brand asset/color confirmation at visual review; no green theme |

## Business/provider information still needed

1. Approve architecture and identity operating model; provide original repository if one exists outside this workspace.
2. Confirm legal merchant entity, verified contact details, logo/vector rights and actual support hours/policies.
3. Confirm pilot polygons, launch stores, operating hours, delivery/customer fee policy and funded free-delivery campaigns.
4. Set rider distance slabs/min/max, commission defaults/overrides, Sunday cutoff/holiday policy, payout fees/minimum and any disclosed COD offset.
5. Confirm vendor settlement hold/eligibility, first-year-free scope, plan prices/volume limits and renewal consent.
6. Approve KYC document/retention policy with qualified local review; identify only authorized verification channels.
7. Provide provider contracts/sandbox access when ready: payments, QR, MFS/bank payout, OAuth, maps, email/SMS/push/WhatsApp and AI. Missing items remain disabled.
8. Choose cloud/residency/budget/domain/on-call owner before any paid provisioning; production authorization remains separate.

None of these blockers justifies fabricated credentials, payments, KYC results or production data. Development can proceed with secure interfaces and clearly labelled test fixtures after architecture approval, within the approved no-paid-resource boundary.

## Change log

| Date | Change | Validation boundary |
|---|---|---|
| 2026-11-01 | Initial source recovery and Phase-1 design package | Document/contract checks only; no application tests |
