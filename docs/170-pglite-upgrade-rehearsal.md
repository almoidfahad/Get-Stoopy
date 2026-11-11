# Supplemental disposable migration rehearsal

`tools/verify-zone-boundary-pglite.mjs` applies the repository SQL migrations through 0077 and the grants script in new **in-memory** PGlite/PostGIS instances. It neither reads a database URL nor connects to a hosted database. It deliberately refuses to run when the latest migration differs from 0077 until this rehearsal is reviewed for the new chain.

The four independent scenarios verify:

1. A fresh chain applies in order, the pointer and history tables start empty, and `gs_runtime` and `gs_privileged` have none of PostgreSQL's table privileges on either table after the grants script.
2. Upgrading from 0074 with existing synthetic approved and draft boundaries preserves the seeded metadata and exact EWKB geometry, with no pointer or history backfill. Existing approved boundaries reject even no-op updates and deletion; drafts remain editable and deletable; changing source or geometry while approving a draft fails; approval of the already-stored proposal succeeds and subsequently becomes immutable.
3. Upgrading from 0076 with synthetic approved zone geography but no pointer preserves the seeded metadata and exact EWKB geometry, and a subsequent pointer insert and replacement record the expected history.
4. Upgrading from 0076 with an existing pointer raises the intended precondition error; after rollback the seeded boundary snapshot and pointer remain unchanged and the history table does not exist.

## Reproduce locally

Requires Node and npm. Install the pinned test-only dependencies into an isolated directory **outside the repository**; this does not change the project dependency manifests:

```sh
mkdir -p /tmp/stoopy-pglite-rehearsal
npm install --prefix /tmp/stoopy-pglite-rehearsal --no-save --ignore-scripts \
  @electric-sql/pglite@0.5.16 @electric-sql/pglite-postgis@0.2.16
node tools/verify-zone-boundary-pglite.mjs --dependency-dir /tmp/stoopy-pglite-rehearsal
```

The harness checks those exact installed versions, but this installation is not lockfile-pinned. On the working branch it completed successfully against 77 migrations. This result is supplementary: PGlite is not the production PostgreSQL server, the SQL is applied directly rather than through Prisma deployment, and a single in-process connection cannot validate multi-connection locking. The seed covers only selected geography and fields, not every existing-data upgrade case. This does not validate Redis, authentication, the API or the full integration suite. See `docs/169-pointer-history-verification.md` for the separate native PostgreSQL synthetic concurrency check and the GitHub Actions billing blocker. The updated repository integration tests still require a successful real PostgreSQL/PostGIS/Redis CI run.

No hosted migration, production activation or deployment is authorized by this rehearsal. The pointer/history remain inert; authorization, independent approval, actor/reason, overlap and deactivation policy, and transactional snapshot semantics remain unresolved.
