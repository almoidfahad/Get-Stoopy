#!/usr/bin/env node
/**
 * Supplemental, network-free verification against a new in-memory PGlite DB.
 * Never connects to a configured/hosted database. This is NOT the PostgreSQL +
 * Redis integration suite. Dependencies are installed outside the repository.
 * See docs/170-pglite-upgrade-rehearsal.md for setup and limitations.
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if (process.argv.length !== 4 || process.argv[2] !== '--dependency-dir') {
  throw new Error('Usage: node tools/verify-zone-boundary-pglite.mjs --dependency-dir <isolated npm directory>');
}
const dependencyDir = resolve(process.argv[3]);
for (const [pkg, version] of [['pglite', '0.5.16'], ['pglite-postgis', '0.2.16']]) {
  const manifest = JSON.parse(readFileSync(join(dependencyDir, 'node_modules', '@electric-sql', pkg, 'package.json'), 'utf8'));
  if (manifest.version !== version) throw new Error(`Expected @electric-sql/${pkg}@${version}`);
}
const require = createRequire(join(dependencyDir, 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const { postgis } = require('@electric-sql/pglite-postgis');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = join(root, 'packages/db/prisma/migrations');
const migrations = readdirSync(migrationDir).filter(name => /^\d{4}_/.test(name)).sort();
if (migrations.at(-1) !== '0077_isolated_boundary_pointer_history') throw new Error('Rehearsal requires review for the current migration chain');
const migration = name => readFileSync(join(migrationDir, name, 'migration.sql'), 'utf8');
const grants = readFileSync(join(root, 'scripts/db-grants.sql'), 'utf8');
const ids = Array.from({ length: 10 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const [country, region, district, city, zone, firstBoundary, secondBoundary, approver, draftBoundary, deletableDraft] = ids;

async function createBase(migrationCount = migrations.length - 1) {
  // No dataDir or remote connection string: this instance exists only in memory.
  const db = new PGlite({ extensions: { postgis } });
  try {
    await db.exec('CREATE EXTENSION postgis; CREATE ROLE gs_owner; CREATE ROLE gs_runtime; CREATE ROLE gs_privileged; GRANT CREATE,USAGE ON SCHEMA public TO gs_owner; SET ROLE gs_owner;');
    for (const name of migrations.slice(0, migrationCount)) await db.exec(migration(name));
    return db;
  } catch (error) { await db.close(); throw error; }
}

async function seed(db) {
  await db.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,'ZZ','Synthetic','BDT','+880','Asia/Dhaka','DRAFT')`, [country]);
  await db.query(`INSERT INTO "Region"(id,"countryId",code,name) VALUES ($1,$2,'r','Synthetic')`, [region, country]);
  await db.query(`INSERT INTO "District"(id,"regionId",code,name) VALUES ($1,$2,'d','Synthetic')`, [district, region]);
  await db.query(`INSERT INTO "City"(id,"districtId",code,name,kind) VALUES ($1,$2,'c','Synthetic','CITY')`, [city, district]);
  await db.query(`INSERT INTO "ServiceZone"(id,"cityId",code,name) VALUES ($1,$2,'z','Synthetic')`, [zone, city]);
  for (const [id, version] of [[firstBoundary, 1], [secondBoundary, 2]]) {
    await db.query(`INSERT INTO "BoundaryVersion"(id,"ownerType","ownerId",version,boundary,source,"validFrom","approvedBy","contentHash") VALUES ($1,'ZONE',$2,$3,ST_GeomFromEWKT('SRID=4326;MULTIPOLYGON(((40 10,41 10,41 11,40 11,40 10)))'),'fixture',now()-interval '1 day',$4,'hash')`, [id, zone, version, approver]);
  }
}
async function snapshot(db) {
  return (await db.query(`SELECT id,"ownerType","ownerId",version,encode(ST_AsEWKB(boundary),'hex') AS geometry,source,"validFrom","approvedBy","contentHash","createdAt" FROM "BoundaryVersion" WHERE "ownerId"=$1 ORDER BY version`, [zone])).rows;
}

async function freshInstall() {
  const db = await createBase();
  try {
    await db.exec(migration(migrations.at(-1)));
    await db.exec(grants);
    const counts = await db.query(`SELECT (SELECT count(*)::int FROM "ZoneBoundaryPointer") AS pointers, (SELECT count(*)::int FROM "ZoneBoundaryPointerHistory") AS history`);
    assert.deepEqual(counts.rows, [{ pointers: 0, history: 0 }]);
    for (const role of ['gs_runtime', 'gs_privileged']) {
      for (const table of ['"ZoneBoundaryPointer"', '"ZoneBoundaryPointerHistory"']) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          const result = await db.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [role, table, privilege]);
          assert.equal(result.rows[0].allowed, false, `${role} unexpectedly has ${privilege} on ${table}`);
        }
      }
    }
    console.log(`Fresh install: ${migrations.length} migrations and grants applied; pointer tables empty and application roles denied table privileges.`);
  } finally { await db.close(); }
}

async function upgrade(preexistingPointer) {
  const db = await createBase();
  try {
    await seed(db);
    if (preexistingPointer) await db.query(`INSERT INTO "ZoneBoundaryPointer" VALUES ($1,$2,1)`, [zone, firstBoundary]);
    const before = await snapshot(db);
    if (preexistingPointer) {
      await assert.rejects(db.exec(migration(migrations.at(-1))), /zone_boundary_pointer_history_requires_empty_table/);
      await db.exec('ROLLBACK');
      assert.deepEqual(await snapshot(db), before);
      assert.deepEqual((await db.query(`SELECT "boundaryId",version FROM "ZoneBoundaryPointer" WHERE "zoneId"=$1`, [zone])).rows, [{ boundaryId: firstBoundary, version: 1 }]);
      assert.equal((await db.query(`SELECT to_regclass('public."ZoneBoundaryPointerHistory"') AS tbl`)).rows[0].tbl, null);
      console.log('Upgrade with existing pointer refused; history and pointer unchanged, no history table created.');
    } else {
      await db.exec(migration(migrations.at(-1)));
      await db.exec(grants);
      assert.deepEqual(await snapshot(db), before);
      await db.query(`INSERT INTO "ZoneBoundaryPointer" VALUES ($1,$2,1)`, [zone, firstBoundary]);
      await db.query(`UPDATE "ZoneBoundaryPointer" SET "boundaryId"=$2,version=2 WHERE "zoneId"=$1`, [zone, secondBoundary]);
      const history = await db.query(`SELECT version,"boundaryId","previousBoundaryId" FROM "ZoneBoundaryPointerHistory" WHERE "zoneId"=$1 ORDER BY version`, [zone]);
      assert.deepEqual(history.rows, [{ version: 1, boundaryId: firstBoundary, previousBoundaryId: null }, { version: 2, boundaryId: secondBoundary, previousBoundaryId: firstBoundary }]);
      assert.deepEqual(await snapshot(db), before);
      console.log('Upgrade with existing geography preserved geometry and metadata; pointer history recorded.');
    }
  } finally { await db.close(); }
}

async function upgradeFromBeforeImmutability() {
  const firstNewMigration = migrations.indexOf('0075_approved_boundary_immutability');
  assert.notEqual(firstNewMigration, -1, 'Missing migration 0075');
  const db = await createBase(firstNewMigration);
  try {
    await seed(db);
    for (const [id, version] of [[draftBoundary, 3], [deletableDraft, 4]]) {
      await db.query(`INSERT INTO "BoundaryVersion"(id,"ownerType","ownerId",version,boundary,source,"validFrom","approvedBy","contentHash") VALUES ($1,'ZONE',$2,$3,ST_GeomFromEWKT('SRID=4326;MULTIPOLYGON(((40 10,41 10,41 11,40 11,40 10)))'),'draft',now()-interval '1 day',NULL,'draft-hash')`, [id, zone, version]);
    }
    const before = await snapshot(db);
    for (const name of migrations.slice(firstNewMigration)) await db.exec(migration(name));
    await db.exec(grants);
    assert.deepEqual(await snapshot(db), before);
    const counts = await db.query(`SELECT (SELECT count(*)::int FROM "ZoneBoundaryPointer") AS pointers, (SELECT count(*)::int FROM "ZoneBoundaryPointerHistory") AS history`);
    assert.deepEqual(counts.rows, [{ pointers: 0, history: 0 }]);
    await assert.rejects(db.query(`UPDATE "BoundaryVersion" SET source=source WHERE id=$1`, [firstBoundary]), /approved_boundary_immutable/);
    await assert.rejects(db.query(`DELETE FROM "BoundaryVersion" WHERE id=$1`, [firstBoundary]), /approved_boundary_immutable/);
    await assert.rejects(db.query(`UPDATE "BoundaryVersion" SET "approvedBy"=$2,source='changed during approval' WHERE id=$1`, [draftBoundary, approver]), /boundary_approval_must_not_change_proposal/);
    await assert.rejects(db.query(`UPDATE "BoundaryVersion" SET "approvedBy"=$2,boundary=ST_GeomFromEWKT('SRID=4326;MULTIPOLYGON(((42 10,43 10,43 11,42 11,42 10)))') WHERE id=$1`, [draftBoundary, approver]), /boundary_approval_must_not_change_proposal/);
    assert.deepEqual(await snapshot(db), before);
    await db.query(`UPDATE "BoundaryVersion" SET source='edited draft' WHERE id=$1`, [draftBoundary]);
    await db.query(`DELETE FROM "BoundaryVersion" WHERE id=$1`, [deletableDraft]);
    await db.query(`UPDATE "BoundaryVersion" SET "approvedBy"=$2 WHERE id=$1`, [draftBoundary, approver]);
    await assert.rejects(db.query(`UPDATE "BoundaryVersion" SET source='changed after approval' WHERE id=$1`, [draftBoundary]), /approved_boundary_immutable/);
    const final = await snapshot(db);
    assert.deepEqual(final.slice(0, 2), before.slice(0, 2));
    assert.equal(final.length, 3);
    assert.equal(final[2].source, 'edited draft');
    assert.equal(final[2].approvedBy, approver);
    console.log('Upgrade 0074→0077 preserved pre-existing approved/draft boundaries and left pointers empty; post-upgrade guards checked.');
  } finally { await db.close(); }
}

await freshInstall();
await upgradeFromBeforeImmutability();
await upgrade(false);
await upgrade(true);
console.log('Supplemental PGlite/PostGIS checks passed; full PostgreSQL/Redis integration is still required.');
