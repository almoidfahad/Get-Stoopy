import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { asSuper, urls, withClient } from './helpers';

const u = urls();
const polygon = 'SRID=4326;MULTIPOLYGON(((31 11,32 11,32 12,31 12,31 11)))';
const insert = `INSERT INTO "BoundaryVersion"(id,"ownerType","ownerId",version,boundary,source,"validFrom","approvedBy","contentHash") VALUES ($1,'ZONE',$2,1,ST_GeomFromEWKT($3),'fixture',now()-interval '1 day',$4,'fixture-hash')`;

// One test rehearses DDL inside a rollback-only transaction. Never run it on a
// shared or remote database, irrespective of environment labels.
const ownerTarget = new URL(u.owner);
if (!['localhost', '127.0.0.1', '[::1]'].includes(ownerTarget.hostname) || ownerTarget.pathname !== '/getstoopy_test') {
  throw new Error('Boundary history tests require the local disposable getstoopy_test database');
}

describe('approved boundary history', () => {
  it('allows draft edits but approval cannot change the proposal, and approved rows cannot be edited or deleted', async () => {
    const id = randomUUID(), zone = randomUUID(), approver = randomUUID();
    await asSuper(u.privileged, c => c.query(insert, [id, zone, polygon, null]));
    await asSuper(u.privileged, c => c.query(`UPDATE "BoundaryVersion" SET source='revised-draft' WHERE id=$1`, [id]));
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "BoundaryVersion" SET "approvedBy"=$2, source='altered-at-approval' WHERE id=$1`, [id, approver]))).rejects.toThrow('boundary_approval_must_not_change_proposal');
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "BoundaryVersion" SET "approvedBy"=$2, boundary=ST_GeomFromEWKT($3) WHERE id=$1`, [id, approver, 'SRID=4326;MULTIPOLYGON(((31 11,33 11,33 12,31 12,31 11)))']))).rejects.toThrow('boundary_approval_must_not_change_proposal');
    await asSuper(u.privileged, c => c.query(`UPDATE "BoundaryVersion" SET "approvedBy"=$2 WHERE id=$1`, [id, approver]));
    for (const statement of [
      `UPDATE "BoundaryVersion" SET source='changed' WHERE id=$1`,
      `UPDATE "BoundaryVersion" SET "approvedBy"=NULL WHERE id=$1`,
      `UPDATE "BoundaryVersion" SET "ownerId"=gen_random_uuid() WHERE id=$1`,
      `UPDATE "BoundaryVersion" SET "validFrom"=now() WHERE id=$1`,
      `UPDATE "BoundaryVersion" SET boundary=ST_Translate(boundary,1,0) WHERE id=$1`,
      `UPDATE "BoundaryVersion" SET source=source WHERE id=$1`,
    ]) await expect(asSuper(u.privileged, c => c.query(statement, [id]))).rejects.toThrow('approved_boundary_immutable');
    await expect(asSuper(u.privileged, c => c.query(`DELETE FROM "BoundaryVersion" WHERE id=$1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(asSuper(u.owner, c => c.query(`DELETE FROM "BoundaryVersion" WHERE id=$1`, [id]))).rejects.toThrow('approved_boundary_immutable');
    const row = await asSuper(u.privileged, c => c.query(`SELECT source,"approvedBy",ST_AsEWKT(boundary) AS geometry FROM "BoundaryVersion" WHERE id=$1`, [id]));
    expect(row.rows[0]).toEqual({ source: 'revised-draft', approvedBy: approver, geometry: polygon });
  });

  it('serializes approval against concurrent edits; the waiting edit fails after approval commits', async () => {
    const id = randomUUID(), zone = randomUUID(), approver = randomUUID();
    await asSuper(u.privileged, c => c.query(insert, [id, zone, polygon, null]));
    const first = new pg.Client({ connectionString: u.owner }); const second = new pg.Client({ connectionString: u.owner });
    await first.connect(); await second.connect();
    try {
      await first.query('BEGIN');
      await first.query(`UPDATE "BoundaryVersion" SET "approvedBy"=$2 WHERE id=$1`, [id, approver]);
      const pending = second.query(`UPDATE "BoundaryVersion" SET source='concurrent-change' WHERE id=$1`, [id]).then(() => null, error => error);
      await first.query('COMMIT');
      expect(String(await pending)).toContain('approved_boundary_immutable');
      expect((await second.query(`SELECT source,"approvedBy" FROM "BoundaryVersion" WHERE id=$1`, [id])).rows[0]).toEqual({ source: 'fixture', approvedBy: approver });
    } finally { await first.query('ROLLBACK').catch(() => {}); await first.end(); await second.end(); }
  });

  it('installs the guard over existing approved rows without rewriting them', async () => {
    const migration = readFileSync(new URL('../../packages/db/prisma/migrations/0075_approved_boundary_immutability/migration.sql', import.meta.url), 'utf8');
    await withClient(u.owner, async c => {
      await c.query('BEGIN');
      try {
        await c.query(`DROP TRIGGER approved_boundary_immutable ON "BoundaryVersion"`);
        const id = randomUUID(); await c.query(insert, [id, randomUUID(), polygon, randomUUID()]);
        const snapshot = async () => (await c.query(`SELECT id,"ownerType","ownerId",version,ST_AsEWKB(boundary) AS boundary,source,"validFrom","approvedBy","contentHash","createdAt" FROM "BoundaryVersion" WHERE id=$1`, [id])).rows[0];
        const before = await snapshot();
        await c.query(migration);
        expect(await snapshot()).toEqual(before);
        await c.query('SAVEPOINT before_attempt');
        await expect(c.query(`UPDATE "BoundaryVersion" SET source='bad' WHERE id=$1`, [id])).rejects.toThrow('approved_boundary_immutable');
        await c.query('ROLLBACK TO SAVEPOINT before_attempt');
        expect(await snapshot()).toEqual(before);
      } finally { await c.query('ROLLBACK'); }
    });
  });
});
