# Existing Supabase project: local coexistence rehearsal

## Purpose and boundaries

The owner requested the next step after the read-only audit (`docs/188`) and wants to keep the existing Free-plan project and avoid paid services. The exact target project and requirement to preserve its editorial application still require explicit confirmation before a hosted change. This step creates **no production DB schema, migration, Auth/Storage setting, branch, account, paid service, or deployment**. It tests disposable, invented examples only.

`tools/verify-synthetic-shared-schema.mjs` runs three PGlite/PostGIS experiments in entirely new in-memory databases. It uses no database connection string, hosted data, or customer records. Tested with `@electric-sql/pglite@0.5.16` and `@electric-sql/pglite-postgis@0.2.16` in an isolated npm directory. PGlite is not a Supabase replica, the SQL is applied directly (not via Prisma migrate deploy), and these single-process checks do not establish concurrency, production access control, or restoration.

## Results

1. **Representative shared `public` fixture:** synthetic `auth.users`, an Auth trigger and `public.profiles`, `categories`, and `articles` were created with dummy data, a foreign key, policy and selected grants. All **77 existing Get Stoopy migrations** and `scripts/db-grants.sql` ran against that disposable database. The selected editorial rows, relation flags/ACLs, constraints, policy, Auth trigger and trigger-function definition compared equal before and after; a second synthetic Auth insert still created a profile. This demonstrates only those selected objects in this fixture, **not** preservation of the actual 19 hosted tables, users, migration history or application behavior. Creating 106 additional app models in the public schema could still affect defaults, search paths, performance, privileges and operating limits.
2. **Broad default grants fixture:** the fake `gs_owner` was intentionally given broad default table privileges for `anon` and `authenticated`. The new `Order` table retained those grants after `db-grants.sql`; even with RLS enabled, a synthetic `anon` role still had `TRUNCATE` and `authenticated` had `UPDATE` at the table-privilege layer. RLS doesn't protect `TRUNCATE`. This fixture does **not** establish the actual hosted owner's default privileges or a live exploit. It demonstrates that existing grant setup cannot be assumed to neutralize a shared project's default ACLs: a future design must inspect effective default privileges, role memberships, grant and exposed-schema behavior, and verify independently.
3. **Different schema:** with a synthetic `marketplace."User"` and no `public` Get Stoopy inventory, unmodified `scripts/db-grants.sql` refused to run, preserving the selected fixture and table ACL. The script sets its search path to `pg_catalog, public` and explicitly validates/changes `public` inventory. A namespace cannot be adopted merely by changing `search_path`; reviewed changes to schema-qualified code, privileges, functions, migration history and tests would be needed. This check did **not** attempt the full chain in a separate schema and does not prove a schema is otherwise safe.
4. **PostGIS schema:** in a new in-memory DB with PostGIS installed in `extensions`, the geometry equality operator existed in `extensions`, not `public`. Migration `0036` explicitly uses `OPERATOR(public.=)`. Thus a non-public PostGIS installation needs careful compatibility testing; function creation may defer resolution until execution. The hosted audit reported PostGIS *available but not installed*, not its eventual installation location. No hosted extension was installed.

## Comparison for design review — neither option approved

| Option | Potential benefit | Known work and risk |
| --- | --- | --- |
| Share `public` | Existing migrations/grants expect public and ran with the selected synthetic fixture. | Shared grants/default privileges, names, functions, editorial Auth trigger, exposed API and production data all require detailed review. The fixture is not a production replica or proof of safe coexistence. |
| Dedicated marketplace schema in same existing project | Can reduce accidental namespace collisions; no additional paid database branch is inherently assumed. | A schema is not independent security/isolation. Existing public-specific grants, search paths, PostGIS operator, functions and Prisma migrations must be adapted and reviewed. Role memberships, public API exposure, default ACLs, Auth trigger and backup/recovery still affect both apps. No migration or rollout approval is implied. |

A separate namespace in the same Supabase project is only a **candidate**; the rehearsal does not select it or authorize creating it. Reuse Supabase Auth identities only after designing a safe mapping to the repo's `User`/`UserIdentity`, membership and server authorization. Do not replace the editorial `auth.users` trigger or change global Auth redirects without explicit review. Keep service-role credentials server-only; role and ledger permissions need adversarial tests. Existing audit identified potential editorial profile-update and broad-grant concerns; no live account mutation was attempted here.

## Reproduce (synthetic local environment only)

```sh
mkdir -p /tmp/stoopy-pglite-rehearsal
npm install --prefix /tmp/stoopy-pglite-rehearsal --no-save --ignore-scripts \
  @electric-sql/pglite@0.5.16 @electric-sql/pglite-postgis@0.2.16
node tools/verify-synthetic-shared-schema.mjs --dependency-dir /tmp/stoopy-pglite-rehearsal
```

The version check pins direct versions but does not lock transitive dependencies. Do not point this harness at a database: it accepts only an npm dependency-directory argument and always creates in-memory databases. Temporary installation itself needs npm access. Recheck the migration chain if it changes; the harness refuses a different count or last migration. It does not exercise Redis, Supabase Auth/Storage, the API, frontend, backups, marketplace workflows or live COD.

## Next approval-gated steps

1. Owner confirms the exact intended project and that existing editorial app/data must remain unchanged. Verify the current Free-plan dashboard usage and a backup/restore plan without sharing secrets.
2. Develop a precise cohabitation, security/default-ACL and Supabase Auth/Storage design using synthetic fixtures; decide whether public or a dedicated schema can be made safe. No paid branch or new project is needed for the local work; do not bypass the prior branch entitlement restriction.
3. Produce reviewed, version-controlled **incremental** migrations and a safe deployment/rollback plan. Do not execute them, install extensions or alter hosted Auth/Storage before the owner explicitly approves the specific changes.
4. Implement/test checkout, rider routing/assignments, per-delivery cash allocation, retry, reconciliation, RLS and frontend with synthetic data. Existing production order and multi-delivery COD safety gates stay in place until an independently verified replacement is ready. A report or successful synthetic rehearsal does not enable live COD.
