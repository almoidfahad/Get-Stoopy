# 64 — Supabase configuration and safe SQL inventory

## What the current code actually uses

The application does **not** use `NEXT_PUBLIC_SUPABASE_URL` or
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: there is no Supabase JS client in the
web/API code. Adding those variables or redeploying does not connect it to a
database. The Supabase publishable key is not a PostgreSQL connection string and
cannot provision tables or substitute for the app's authorization model. Do not
put a secret/service-role key in a `NEXT_PUBLIC_` variable.

Architecture remains Next.js BFF → NestJS API → PostgreSQL/PostGIS through
Prisma and scoped SQL, with Keycloak identity and separate Redis/worker services.
The web app needs server-side `API_INTERNAL_URL`, `WEB_ORIGIN`,
`KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`,
`BFF_API_SHARED_SECRET`, `SESSION_TOKEN_ENCRYPTION_KEY`, and a configured
`MARKET_COUNTRY_ID` for the catalog. See `apps/web/src/lib/config.ts` and
`apps/web/src/lib/catalog.ts`. The API needs server-only `DATABASE_URL`,
`DATABASE_PRIVILEGED_URL`, `REDIS_URL`, Keycloak and other validated secrets;
see `packages/config/src/index.ts` and `.env.example`. Prisma migrations use
`DATABASE_MIGRATION_URL` when set. These names are not an instruction to place
API database credentials in the web application's environment. Secrets belong
in the relevant service's secret manager, not source control, chat or browser.

As observed on 2026-11-08, Vercel project `getstoopy` had the two Supabase
variables scoped to **Production only**; project `get-stoopy` returned no
project-level variables. Values were not decrypted or verified. The `getstoopy`
redeploy reported `READY` and `PROMOTED` to production, from old commit
`1e315aa`, not this PR's `4e7454f`. It predates subsequent changes, including
security hardening. Build success is not proof of a working or secure backend.
Preview and production are different targets. We did not change deployment
settings, aliases, variables, or deploy production.

## Tables, SQL, and why a generic CREATE script is unsafe

At the reviewed branch revision `packages/db/prisma/schema.prisma` has **103
Prisma models**, and `packages/db/prisma/migrations` has **72 ordered
migrations**, 0001 through 0072. The read-only SQL in
`docs/sql/supabase-read-only-preflight.sql` lists all 103 names and whether each
is present. These model names do not imply that every table is required for the
initial storefront alone or that tables exist in the target database. They
include identity/RBAC/geography, catalog/inventory/cart/quotes, orders/payment,
delivery/dispatch, audit/notification, KYC/risk and finance/ledger tables.

The authoritative table-creation SQL **already exists** in the ordered
`packages/db/prisma/migrations/*/migration.sql` files. They include PostGIS,
enums, indexes, constraints, triggers, RLS policies and other security
invariants, not just `CREATE TABLE`. Prisma also maintains `_prisma_migrations`.
Do **not** paste a flattened set of migration files into SQL Editor, fabricate
migration ledger entries, use `prisma db push`, or create simplified replacement
tables. Doing so can produce schema drift, duplicate-object errors on the next
`prisma migrate deploy`, or insecure partial tables. This is especially risky
on a database whose existing contents, RLS policies and ownership are unknown.

The supplied SQL is read-only metadata inspection, **not table creation SQL**.
It needs no application records and should be run only against the intended
project. Run the optional fourth query only if the first result says the Prisma
ledger is present. Review output before sharing; don't send secrets, URLs with
passwords, customer rows or logs. If the project has existing data, back it up and
stop: a clean install and a pre-existing schema need different plans.

## Required next steps

1. Owner confirms exact project, environment (development vs production),
   existing data, region/residency, and whether a tested backup exists.
2. Review the read-only SQL results, migrations history, extension availability,
   RLS/policies and role privileges. A table or `rls_enabled` flag is not proof
   of correct policies or grants. Supabase's `public` schema/API exposure and
   existing default privileges require explicit review; never expose sensitive
   data with broad anon/authenticated access.
3. Agree a forward migration and role/grant plan compatible with Supabase's
   managed permissions, preserving ownership and least privilege. Prisma is the
   migration owner; use `npm run db:migrate` only after approval, with a secure
   migration connection, not the publishable key. Verify role bootstrap and
   `scripts/db-grants.sql` for the target environment before applying; they were
   developed for the isolated local database and are not pre-approved for this
   project. Do not assume the hosted admin role can perform every local step.
4. Deploy/configure API, identity and worker separately as needed; set only
   server-side environment values on the appropriate service, then test RLS,
   permissions, migrations and user flows in an isolated development environment.
   Never turn on production/live payments based on a successful web build alone.

No SQL was run against Supabase here. The connector previously returned 403 for
this project; the SQL inventory is for the owner to run and inspect, not evidence
of target database state.
