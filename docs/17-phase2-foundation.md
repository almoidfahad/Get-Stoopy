# Phase 2 — Foundation implementation log

Status: **IN PROGRESS — first foundation slice implemented and unit-tested.** Owner architecture approval recorded 2026-11-01, including proposed Keycloak identity model. This does not mean the full marketplace, Keycloak deployment, payment integration or production readiness is complete.

## Implemented in this slice

- npm workspace monorepo with pinned runtime engines and lockfile. Initially Node 20; the current requirement is **Node `26.x` / npm 10**, verified locally and in both CI jobs with Node **26.13.0** / npm **10.8.2** (2026-11-02).
- `@getstoopy/core`: deny-by-default permission checks, geographic scope containment, owner/vendor/rider paths, MFA/step-up requirements, self-scope-grant denial, scope expiry/revocation, integer minor-unit money, pro-rata allocation, balanced-journal checks, commission rounding, distance-slab validation/pricing, 30-second offer expiry helpers and manual-ready state guard.
- `@getstoopy/auth`: opaque token generation/hashing, constant-time comparison, idle/absolute session expiry, revocation check, Secure/HttpOnly/SameSite cookie options, production `__Host-` cookie naming, PKCE S256 helpers and exact redirect allowlist.
- `@getstoopy/config`: validated environment schema; live payment/QR/payout/AI flags default false; cross-border enablement rejected; production HTTP and non-host cookie rejected.
- `@getstoopy/observability`: structured logging with recursive sensitive-key redaction and level filtering.
- `@getstoopy/ui`: centralized Get Stoopy red/white/black brand tokens, CSS variables, focus and reduced-motion helpers. Exact original vector asset and final visual comparison remain pending.
- `@getstoopy/db`: Prisma foundation schema and generated initial migration plus PostGIS/RLS/append-only additions. Covers identity, sessions, roles/permissions, admin scopes, administrative geography, boundary versions, audit, outbox/inbox, idempotency and feature flags. Full commerce/finance/KYC tables remain later Phase-2/3–7 work.
- Local Docker Compose template: PostGIS, Redis, Keycloak, MinIO, Mailpit; Keycloak realm import template; local-only ports; no paid cloud resource.
- GitHub Actions CI: install, Prisma Client generation, typecheck, unit tests, Prisma validation and design-artifact validation. The separate integration job generates Prisma Client, applies migrations/grants and runs `build:packages` before `test:integration`. Generation uses a non-secret placeholder URL in the validate job and does not connect to a database.

## Verification actually run

| Check | Result | Boundary |
|---|---|---|
| `npm run typecheck` | PASS | TypeScript foundation packages only |
| `npm test` | **58 tests passed / 7 files** | Unit tests for core/auth/config/observability; no database/network/provider |
| `npm run db:validate` with CI placeholder DATABASE_URL | PASS | Prisma schema syntax only; no migration applied |
| Design/contract validation | See `16-validation-report.md` | Documents/contracts, not runtime security |

## Not yet implemented / not yet proven

- Running Next.js web/BFF, NestJS API and worker processes.
- Live Keycloak login, Argon2id parameter benchmark, Google Authenticator interoperability, OAuth linking, recovery and emergency revocation.
- PostgreSQL migration execution, RLS behavior under a real runtime role, pooled `SET LOCAL` context tests and PostGIS query plans.
- Full 113-entity executable schema, commerce/finance/KYC/delivery modules, Socket.IO, BullMQ processors and object-storage integration.
- Provider sandboxes, real payments, QR, payouts, maps, notifications or AI.
- Playwright E2E, accessibility audit, load tests, penetration test, backup restore drill or production deployment.

## Local development boundary

Copy `.env.example` to `.env` and replace local-only placeholders before starting containers. Do not commit `.env`. The compose file binds services to localhost for development; it is not a production deployment. Keycloak realm template disables public registration and implicit/direct-grant flows and configures TOTP policy, but the privileged-admin mandatory MFA flow, Argon2id selection and safe linking still require implementation/testing.

## Superseded next-task list

The API/BFF/RLS slice is recorded in `18-phase2-api-bff-rls.md`. Remaining Phase-2 work:

1. Live Keycloak realm import and browser OIDC/TOTP/linking/recovery verification.
2. Expand schema toward approved logical model in reviewed increments.
3. Add worker/outbox/inbox and private-storage interfaces.
4. Add visual design-system components and Playwright E2E before Phase 3.

## Original next-task list (historical)

1. Add NestJS API shell with health, request ID, structured logging, session resolution and guarded example resource.
2. Add Next.js BFF shell and OIDC callback/session flow against local Keycloak.
3. Apply migrations to local PostGIS; create least-privileged runtime role; test RLS and append-only constraints.
4. Expand schema toward approved logical model in reviewed increments.
5. Add worker/outbox/inbox and private-storage interfaces.
6. Add integration tests and visual design-system components before Phase 3.

No phase is marked complete until its acceptance gates pass.
