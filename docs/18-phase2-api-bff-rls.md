# Phase 2 — API shell, BFF/OIDC and real PostGIS/RLS verification

Status: **IN PROGRESS — second foundation slice implemented and integration-tested locally.** This is not production readiness, not a live payment system, and not the full marketplace.

## Implemented

- `apps/api`: NestJS modular-monolith shell with `/api/v1` prefix, request IDs, structured redacted HTTP logs, stable error filter, Helmet, explicit CORS allowlist, validation pipe, open Swagger document, health/live and health/ready.
- Opaque server-side sessions: SHA-256 token hashes, idle + absolute expiry, revocation, authorization-version check, encrypted provider-token envelope, CSRF token derivation and Origin checks on cookie-authenticated mutations.
- BFF-only session creation endpoint protected by a shared secret; ID-token verification through Keycloak JWKS; no automatic email-only account linking.
- `apps/web`: Next.js App Router BFF shell with login, callback, logout and me routes; encrypted short-lived OIDC transaction cookie; PKCE S256, state and nonce checks through `openid-client`; same-origin logout; red/white/black development shell.
- `packages/bff`: AES-256-GCM JSON envelopes, CSRF derivation and OIDC transaction helpers.
- Real PostgreSQL 17 + PostGIS 3.5 local verification database with separate owner, runtime and privileged roles. Runtime has neither superuser nor `BYPASSRLS`.
- Migrations `0001`–`0004` applied locally. Hardening fixed an unintended `AdminScope` self-insert path, locked RBAC writes to the privileged role, guarded user security fields and made audit append-only enforcement reachable.

## Verification actually run

| Check | Result | Boundary |
|---|---|---|
| `npm run typecheck` | PASS | packages + API + web TypeScript |
| `npm test` | **63 tests / 8 files PASS** | unit tests, including BFF crypto/OIDC guards |
| `npm run test:integration` | **20 tests / 2 files PASS** | real local PostgreSQL/PostGIS, RLS, append-only, NestJS HTTP shell |
| `npm run build:api` | PASS | NestJS TypeScript build |
| `npm run build:web` | PASS | Next.js production build locally |
| Prisma migrations | PASS | applied to local `getstoopy` and `getstoopy_test` |

Integration coverage includes: PostGIS containment query, invalid geometry rejection, unscoped runtime denial, runtime self-scope isolation, session token-hash lookup, no runtime self-elevation, admin-scope/RBAC write denial, user security-field guard, audit/outbox append-only behavior, API health, opaque-session resolution, geographic admin denial, CSRF/Origin denial and BFF secret denial.

## Live Keycloak update

Local Keycloak OIDC login/logout smoke verification now passes; see `19-phase2-keycloak-live.md`. TOTP, linking, recovery and step-up remain pending.

## Still not proven

- Live Keycloak realm import, browser login, TOTP enrollment, OAuth linking, recovery and step-up against a running Keycloak instance.
- Redis/BullMQ workers, Socket.IO, object storage, maps, payments, QR, payouts, notifications and AI.
- Full commerce/finance/KYC/delivery schema and modules, Playwright E2E, accessibility audit, load/penetration tests, backup restore drill and production deployment.

## Local development

1. Copy `.env.example` to `.env` and replace every local placeholder. Never commit `.env`.
2. Start local PostgreSQL/PostGIS and create roles with `scripts/setup-db-roles.sh`.
3. Apply migrations with `npm run db:migrate`, then run `scripts/db-grants.sql` as the owner role.
4. Seed non-secret local geography/RBAC fixtures with `npm run db:seed`.
5. Run `npm run dev:api` and `npm run dev:web`. Keycloak must be running and the confidential client secret/redirect URI must match the realm before browser login can succeed.

The GitHub Actions workflow now includes a PostGIS service job for migrations and integration tests.
