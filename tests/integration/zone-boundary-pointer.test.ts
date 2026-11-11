import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { asSuper, urls, withClient } from './helpers';

const u = urls();
for (const connection of [u.owner, u.runtime, u.privileged]) {
  const target = new URL(connection);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/getstoopy_test') throw new Error('Zone pointer tests require the local disposable getstoopy_test database');
}
const zone = randomUUID(), otherZone = randomUUID(), raceZone = randomUUID();
const approved = randomUUID(), next = randomUUID(), foreign = randomUUID(), future = randomUUID(), draft = randomUUID(), cityBoundary = randomUUID(), empty = randomUUID(), outside = randomUUID();
const raceFirst = randomUUID(), raceSecond = randomUUID(), raceThird = randomUUID();
const geometry = 'SRID=4326;MULTIPOLYGON(((40 10,41 10,41 11,40 11,40 10)))';

beforeAll(async () => {
  await asSuper(u.owner, async c => {
    const country = randomUUID(), region = randomUUID(), district = randomUUID(), city = randomUUID();
    await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,$2,'Pointer Fixture','BDT','+880','Asia/Dhaka','DRAFT')`, [country, `fixture-${country}`]);
    await c.query(`INSERT INTO "Region"(id,"countryId",code,name,status) VALUES ($1,$2,'p','Pointer','ACTIVE')`, [region, country]);
    await c.query(`INSERT INTO "District"(id,"regionId",code,name,status) VALUES ($1,$2,'p','Pointer','ACTIVE')`, [district, region]);
    await c.query(`INSERT INTO "City"(id,"districtId",code,name,kind,status) VALUES ($1,$2,'p','Pointer','CITY','ACTIVE')`, [city, district]);
    for (const id of [zone, otherZone, raceZone]) await c.query(`INSERT INTO "ServiceZone"(id,"cityId",code,name,status) VALUES ($1,$2,$3,'Pointer','ACTIVE')`, [id, city, id]);
    const boundary = async (id: string, ownerId: string, version: number, opts: { type?: string; approved?: boolean; future?: boolean; geometry?: string } = {}) => c.query(`INSERT INTO "BoundaryVersion"(id,"ownerType","ownerId",version,boundary,source,"validFrom","approvedBy","contentHash") VALUES ($1,$2::"GeographyType",$3,$4,ST_GeomFromEWKT($5),'pointer-test',CASE WHEN $6 THEN now()+interval '1 day' ELSE now()-interval '1 day' END,$7,$8)`, [id, opts.type ?? 'ZONE', ownerId, version, opts.geometry ?? geometry, !!opts.future, opts.approved === false ? null : randomUUID(), `hash-${id}`]);
    await boundary(approved, zone, 1); await boundary(next, zone, 2); await boundary(foreign, otherZone, 1);
    await boundary(future, zone, 3, { future: true }); await boundary(draft, zone, 4, { approved: false });
    await boundary(cityBoundary, zone, 1, { type: 'CITY' });
    await boundary(empty, zone, 5, { geometry: 'SRID=4326;MULTIPOLYGON EMPTY' });
    await boundary(outside, zone, 6, { geometry: 'SRID=4326;MULTIPOLYGON(((181 10,182 10,182 11,181 11,181 10)))' });
    await boundary(raceFirst, raceZone, 1); await boundary(raceSecond, raceZone, 2); await boundary(raceThird, raceZone, 3);
  });
});

describe('isolated zone boundary pointer foundation', () => {
  it('does not backfill pointers and rejects wrong, unapproved, future and unusable boundaries', async () => {
    const before = await asSuper(u.owner, c => c.query(`SELECT * FROM "ZoneBoundaryPointer" WHERE "zoneId"=$1`, [zone]));
    expect(before.rowCount).toBe(0);
    for (const id of [randomUUID(), foreign, future, draft, cityBoundary]) {
      await expect(asSuper(u.owner, c => c.query(`INSERT INTO "ZoneBoundaryPointer"("zoneId","boundaryId",version) VALUES ($1,$2,1)`, [zone, id]))).rejects.toThrow('zone_boundary_pointer_boundary_invalid');
    }
    for (const id of [empty, outside]) await expect(asSuper(u.owner, c => c.query(`INSERT INTO "ZoneBoundaryPointer"("zoneId","boundaryId",version) VALUES ($1,$2,1)`, [zone, id]))).rejects.toThrow('zone_boundary_pointer_geometry_invalid');
    await expect(asSuper(u.owner, c => c.query(`INSERT INTO "ZoneBoundaryPointer"("zoneId","boundaryId",version) VALUES ($1,$2,2)`, [zone, approved]))).rejects.toThrow('zone_boundary_pointer_initial_version');
    expect((await asSuper(u.owner, c => c.query(`SELECT * FROM "ZoneBoundaryPointer" WHERE "zoneId"=$1`, [zone]))).rowCount).toBe(0);
    expect((await asSuper(u.owner, c => c.query(`SELECT * FROM "ZoneBoundaryPointerHistory" WHERE "zoneId"=$1`, [zone]))).rowCount).toBe(0);
  });

  it('permits only versioned changes to an approved same-zone boundary, with no deletion', async () => {
    await asSuper(u.owner, c => c.query(`INSERT INTO "ZoneBoundaryPointer"("zoneId","boundaryId",version) VALUES ($1,$2,1)`, [zone, approved]));
    await expect(asSuper(u.owner, c => c.query(`UPDATE "ZoneBoundaryPointer" SET "boundaryId"=$2,version=3 WHERE "zoneId"=$1`, [zone, next]))).rejects.toThrow('zone_boundary_pointer_version_invalid');
    await expect(asSuper(u.owner, c => c.query(`UPDATE "ZoneBoundaryPointer" SET version=2 WHERE "zoneId"=$1`, [zone]))).rejects.toThrow('zone_boundary_pointer_version_invalid');
    await expect(asSuper(u.owner, c => c.query(`UPDATE "ZoneBoundaryPointer" SET "boundaryId"=$2,version=2 WHERE "zoneId"=$1`, [zone, foreign]))).rejects.toThrow('zone_boundary_pointer_boundary_invalid');
    expect((await asSuper(u.owner, c => c.query(`SELECT "boundaryId",version FROM "ZoneBoundaryPointer" WHERE "zoneId"=$1`, [zone]))).rows[0]).toEqual({ boundaryId: approved, version: 1 });
    await asSuper(u.owner, c => c.query(`UPDATE "ZoneBoundaryPointer" SET "boundaryId"=$2,version=2 WHERE "zoneId"=$1`, [zone, next]));
    await expect(asSuper(u.owner, c => c.query(`DELETE FROM "ZoneBoundaryPointer" WHERE "zoneId"=$1`, [zone]))).rejects.toThrow('zone_boundary_pointer_delete_forbidden');
    expect((await asSuper(u.owner, c => c.query(`SELECT "boundaryId",version FROM "ZoneBoundaryPointer" WHERE "zoneId"=$1`, [zone]))).rows[0]).toEqual({ boundaryId: next, version: 2 });
    const history = await asSuper(u.owner, c => c.query(`SELECT version,"boundaryId","previousBoundaryId","recordedAt" FROM "ZoneBoundaryPointerHistory" WHERE "zoneId"=$1 ORDER BY version`, [zone]));
    expect(history.rows.map(({ recordedAt, ...row }) => row)).toEqual([{ version: 1, boundaryId: approved, previousBoundaryId: null }, { version: 2, boundaryId: next, previousBoundaryId: approved }]);
    expect(history.rows.every(row => row.recordedAt instanceof Date)).toBe(true);
  });

  it('rejects a concurrent stale update after the first pointer update commits', async () => {
    await asSuper(u.owner, c => c.query(`INSERT INTO "ZoneBoundaryPointer"("zoneId","boundaryId",version) VALUES ($1,$2,1)`, [raceZone, raceFirst]));
    const first = new pg.Client({ connectionString: u.owner }); const second = new pg.Client({ connectionString: u.owner });
    await first.connect(); await second.connect();
    try {
      const firstPid = (await first.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
      const secondPid = (await second.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
      await first.query('BEGIN');
      await first.query(`UPDATE "ZoneBoundaryPointer" SET "boundaryId"=$2,version=2 WHERE "zoneId"=$1`, [raceZone, raceSecond]);
      const waiting = second.query(`UPDATE "ZoneBoundaryPointer" SET "boundaryId"=$2,version=2 WHERE "zoneId"=$1`, [raceZone, raceThird]).then(() => null, error => error);
      // Do not claim a race was tested merely because both promises were
      // started: prove the second backend is actually blocked by the first.
      let blocked = false;
      for (let attempt = 0; attempt < 120 && !blocked; attempt++) {
        blocked = (await first.query(`SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked`, [firstPid, secondPid])).rows[0].blocked;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      await first.query('COMMIT');
      expect(String(await waiting)).toContain('zone_boundary_pointer_version_invalid');
      expect((await second.query(`SELECT "boundaryId",version FROM "ZoneBoundaryPointer" WHERE "zoneId"=$1`, [raceZone])).rows[0]).toEqual({ boundaryId: raceSecond, version: 2 });
      const history = await second.query(`SELECT version,"boundaryId","previousBoundaryId" FROM "ZoneBoundaryPointerHistory" WHERE "zoneId"=$1 ORDER BY version`, [raceZone]);
      expect(history.rows).toEqual([{ version: 1, boundaryId: raceFirst, previousBoundaryId: null }, { version: 2, boundaryId: raceSecond, previousBoundaryId: raceFirst }]);
    } finally { await first.query('ROLLBACK').catch(() => {}); await first.end(); await second.end(); }
  });

  it('keeps history append-only and rolls back a pointer change if recording fails', async () => {
    await expect(asSuper(u.owner, c => c.query(`INSERT INTO "ZoneBoundaryPointerHistory"("zoneId",version,"boundaryId","previousBoundaryId") VALUES ($1,3,$2,$3)`, [zone, approved, next]))).rejects.toThrow('zone_pointer_history_append_only');
    await expect(asSuper(u.owner, c => c.query(`UPDATE "ZoneBoundaryPointerHistory" SET "boundaryId"=$2 WHERE "zoneId"=$1 AND version=1`, [zone, next]))).rejects.toThrow('zone_pointer_history_append_only');
    await expect(asSuper(u.owner, c => c.query(`DELETE FROM "ZoneBoundaryPointerHistory" WHERE "zoneId"=$1`, [zone]))).rejects.toThrow('zone_pointer_history_append_only');
    // Inject a failing constraint only inside a rolled-back transaction: a
    // failure in the history insert must roll back the pointer update as well.
    await withClient(u.owner, async c => {
      await c.query('BEGIN');
      try {
        await c.query(`ALTER TABLE "ZoneBoundaryPointerHistory" ADD CONSTRAINT test_history_failure CHECK (false) NOT VALID`);
        await c.query('SAVEPOINT before_pointer_update');
        await expect(c.query(`UPDATE "ZoneBoundaryPointer" SET "boundaryId"=$2, version=3 WHERE "zoneId"=$1`, [zone, approved])).rejects.toThrow('test_history_failure');
        await c.query('ROLLBACK TO SAVEPOINT before_pointer_update');
        expect((await c.query(`SELECT "boundaryId",version FROM "ZoneBoundaryPointer" WHERE "zoneId"=$1`, [zone])).rows[0]).toEqual({ boundaryId: next, version: 2 });
        expect((await c.query(`SELECT count(*)::int AS count FROM "ZoneBoundaryPointerHistory" WHERE "zoneId"=$1`, [zone])).rows[0].count).toBe(2);
      } finally { await c.query('ROLLBACK'); }
    });
  });

  it('refuses an upgrade over existing pointers rather than inventing earlier history', async () => {
    const migration = readFileSync(new URL('../../packages/db/prisma/migrations/0077_isolated_boundary_pointer_history/migration.sql', import.meta.url), 'utf8');
    await withClient(u.owner, async c => {
      try {
        // The precondition fails before any DDL; run the actual migration, not
        // an extracted fragment, against this disposable fixture.
        await expect(c.query(migration)).rejects.toThrow('zone_boundary_pointer_history_requires_empty_table');
      } finally { await c.query('ROLLBACK'); }
      expect((await c.query(`SELECT "boundaryId",version FROM "ZoneBoundaryPointer" WHERE "zoneId"=$1`, [zone])).rows[0]).toEqual({ boundaryId: next, version: 2 });
    });
  });

  it('remains inaccessible to both application roles even after grants are rerun', async () => {
    const grants = readFileSync(new URL('../../scripts/db-grants.sql', import.meta.url), 'utf8');
    await withClient(u.owner, c => c.query(grants));
    const security = await asSuper(u.owner, c => c.query(`SELECT relrowsecurity,relforcerowsecurity,has_table_privilege('gs_runtime','"ZoneBoundaryPointer"','SELECT') AS runtime_read,has_table_privilege('gs_privileged','"ZoneBoundaryPointer"','INSERT') AS privileged_write FROM pg_class WHERE oid='"ZoneBoundaryPointer"'::regclass`));
    expect(security.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true, runtime_read: false, privileged_write: false });
    const historySecurity = await asSuper(u.owner, c => c.query(`SELECT relrowsecurity,relforcerowsecurity,has_table_privilege('gs_runtime','"ZoneBoundaryPointerHistory"','SELECT') AS runtime_read,has_table_privilege('gs_privileged','"ZoneBoundaryPointerHistory"','INSERT') AS privileged_write FROM pg_class WHERE oid='"ZoneBoundaryPointerHistory"'::regclass`));
    expect(historySecurity.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true, runtime_read: false, privileged_write: false });
    await expect(withClient(u.runtime, c => c.query(`SELECT * FROM "ZoneBoundaryPointer"`))).rejects.toThrow(/permission denied/);
    await expect(withClient(u.runtime, c => c.query(`SELECT * FROM "ZoneBoundaryPointerHistory"`))).rejects.toThrow(/permission denied/);
    await expect(asSuper(u.privileged, c => c.query(`INSERT INTO "ZoneBoundaryPointer"("zoneId","boundaryId",version) VALUES ($1,$2,1)`, [otherZone, foreign]))).rejects.toThrow(/permission denied/);
    await expect(asSuper(u.privileged, c => c.query(`SELECT * FROM "ZoneBoundaryPointerHistory"`))).rejects.toThrow(/permission denied/);
  });
});
