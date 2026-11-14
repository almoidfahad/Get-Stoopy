# Phase 3 — Supabase development connection readiness (read-only)

Status: **BLOCKED on project access.** The Supabase connector credential is valid, but the
connected account can see no projects, so no Supabase database has been inspected or changed.
This document records the evidence, the safe tooling added while blocked, and the approval
gates that must pass before any Supabase migration is attempted.

## Observed evidence (2026-11-04)

| Check | Result |
| --- | --- |
| `validate_credential` | success — "Credentials are valid. Successfully connected to Supabase API." |
| `list_organizations` | one organization: `almoidfahad's Org` (`nvzdtellxsolovaexwnr`) |
| `list_organization_members` | `almoidfahad`, role `Owner`, organization MFA not enabled |
| `list_projects` | empty (`items: []`), re-checked after each owner reconnect |
| `get_project` / `get_project_health` for `xiyfzjjgkmtoxchfexyi` | 403 access denied |
| `get_project` / `get_project_health` for `ribdhdxgqmirvnymkkoh` | 403 access denied |

The second reference was taken from the connection host the owner supplied
(`db.ribdhdxgqmirvnymkkoh.supabase.co`); it differs from the first reference. Both are denied
and neither appears in `list_projects`, so the blocker is **account/organization authorization
in the connector**, not the reference string. Denied calls were not retried in a loop, and no
alternative argument was used to try to bypass the denial.

No Supabase project, database, extension, role, schema, table, row, Auth setting, edge function
or API key was created, altered or deleted. No production deployment was made.

## Credential handling

- The owner pasted a publishable key in chat. It was **not** used, stored, written to `.env`, or
  committed. Rotation in the Supabase dashboard was recommended.
- A publishable key is a client-side data API credential; it grants no Management API access and
  cannot resolve a 403 from `get_project`.
- No database password was requested. Connection strings, passwords, tokens and CA private keys
  must never be committed or pasted into chat. `.env` remains git-ignored and untracked.

## What was added while blocked

| Artifact | Purpose |
| --- | --- |
| `scripts/supabase-preflight.mjs` | Read-only inspection of a future development database |
| `packages/core/test/supabase-preflight.test.ts` | Regression tests for read-only, fail-closed and redaction behavior |
| `npm run db:preflight:supabase` | Explicit entrypoint; never part of build, CI deploy or migration scripts |
| `.env.example`: `SUPABASE_DEV_DATABASE_URL`, `SUPABASE_DB_CA_CERT_PATH` | Empty template entries only, no credentials |

Preflight safety properties, asserted by tests:

1. The preflight's fixed statements are `SELECT`s, and the session uses
   `default_transaction_read_only=on` as defense in depth. This setting is not an
   immutable security boundary: a privileged session can change it and SELECTs
   can invoke functions with side effects. Use a restricted role and review the
   queries. URL-parameter override risks were fixed later; see `docs/97-supabase-preflight-connection-safety.md`.
2. TLS certificate verification stays enabled (`rejectUnauthorized: true`). A Supabase root CA
   may be supplied via `SUPABASE_DB_CA_CERT_PATH`; verification is never disabled to make a
   connection succeed.
3. Fails closed when the URL is missing or malformed, when the host is not
   `*.supabase.co` / `*.supabase.com`, or when `NODE_ENV=production`.
4. Connection strings, passwords and driver errors that could embed credentials are never
   printed. Only host, port, database name and connected role name are reported.
5. It applies nothing. Exit codes: `0` inspected with no blockers, `1` usage/configuration error,
   `2` inspected with blockers.

The preflight reports PostGIS availability, existing schemas, `public` table and RLS counts,
presence of the `_prisma_migrations` ledger, and presence/privilege level of `gs_owner`,
`gs_runtime` and `gs_privileged`. Findings are advisory: remediation always needs separate
owner approval.

## Architecture boundaries that do not change

- **Identity stays Keycloak.** Supabase Auth is not enabled, wired or substituted. The approved
  Next.js BFF + NestJS + Keycloak model (docs 01, 18, 19) is unchanged, and marketplace
  authorization continues to come from the application's role/scope tables plus PostgreSQL RLS.
- **Prisma remains the single migration owner.** Supabase would be a managed PostgreSQL/PostGIS
  host, not a second migration system. Do not mix Supabase CLI migration history with
  `packages/db/prisma/migrations`, and never use `prisma db push` against a shared database.
- **Private encrypted storage is unchanged.** KYC and payout-destination encryption, quarantine
  and retention rules (docs 21, 25, 44, 45) still apply. Supabase public storage buckets are not
  an approved substitute for the private object-storage boundary.
- **Applied migrations stay frozen.** Migrations 0001–0065 are already applied to the isolated
  local test database. A new environment gets a reviewed forward plan, not edits to history.

## Endpoint reachability — measured, not assumed (2026-11-04)

The owner then supplied shared-pooler details for the same project reference
(`postgres.<project-ref>` role, region `ap-northeast-2`). DNS resolution and a bare TCP connect
were measured from the development sandbox. **No credentials were sent, no PostgreSQL startup
packet was issued, and no data was read.**

| Endpoint | DNS | TCP connect |
| --- | --- | --- |
| `aws-0-ap-northeast-2.pooler.supabase.com:6543` (transaction mode) | 3 × IPv4 | **open** (~23 ms) |
| `aws-0-ap-northeast-2.pooler.supabase.com:5432` (session mode) | 3 × IPv4 | **open** (~31 ms) |
| `db.<project-ref>.supabase.co:5432` (direct) | IPv6 only (`A` → `ENODATA`) | **`ENETUNREACH`** |

Conclusions:

1. The **direct** hostname is IPv6-only here and unreachable from this network. An IPv4 add-on
   or an IPv6-capable network would be required; neither is assumed or purchased.
2. Port **6543 is transaction-mode** and must not be used for Prisma migrations. The preflight
   raises a blocker and names the remedy.
3. The **session-mode pooler on port 5432** is the migration-capable endpoint from this
   environment, and is the endpoint to configure once access is granted.
4. Region is **`ap-northeast-2` (Seoul)**. For a Bangladesh-first pilot the owner must accept the
   latency and data-residency position, or choose another region. This is an owner decision, not
   an implicit one.

These are network facts only. They do **not** grant database access: the connector still returns
403 and `list_projects` is still empty, so no query, migration or configuration change was made.

## Connection rules that still apply

- RLS context must remain transaction-local (`set_config(..., true)` inside the transaction).
  Session-level context can leak across pooled connections; this is already the worker rule.
- The `postgres` role is highly privileged. It may be acceptable for an owner-run migration
  step, but the application runtime must use the least-privileged `gs_runtime` role with no
  superuser and no `BYPASSRLS`.
- Organization MFA is currently disabled for the connected Supabase account. Enabling it is
  recommended before any non-local data is stored.
- A pooler connection string is still a credential. It belongs in an ignored local `.env` or a
  secret manager, never in chat, source control or CI logs.

## Not installed: third-party agent skills

`npx skills add supabase/agent-skills` was **not** run. It fetches and executes third-party
instructions/scripts and would add unreviewed, unpinned files to the repository. Installing it
requires explicit owner approval plus the normal dependency-pinning and review rules. The
preflight above needs no such dependency.

## Approval gates before any Supabase migration

1. Connector can list the intended project, and `get_project` / `get_project_health` succeed.
2. Owner confirms the environment is **development**, not production, and names the region.
3. Read-only preflight reviewed: PostGIS availability, existing schemas/tables, migration ledger,
   roles and RLS state.
4. Owner approves the exact forward migration plan and the role/grant bootstrap for that database.
5. Only then run migrations, followed by `db:validate`, typecheck, unit, integration and design
   gates, then commit, push and confirm CI plus manual preview-only Vercel checks.

Until gates 1–4 pass, the next product slice proceeds on the existing isolated local/test
PostgreSQL database, and no Supabase schema change is attempted.

## Next slice (unchanged scope)

The next product slice remains a small **fraud-risk / manual-review** increment under the
existing threat model (docs 05, 11, 14): deterministic server-side risk signals, scoped manual
review, appeal path and audit. AI stays advisory and disabled by default; it cannot approve
KYC, refunds, payouts, permission changes or ledger edits. Live payments, payouts, cross-border
and production deployment remain disabled.
