import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { urls, withClient, asUser, asSuper } from './helpers';
const u = urls();
const a = randomUUID(), b = randomUUID();
const tokenA = `test-token-${randomUUID()}`;
const tokenHashA = createHash('sha256').update(tokenA).digest('hex');
const boundaryA = 'SRID=4326;MULTIPOLYGON(((90.35 23.70,90.45 23.70,90.45 23.80,90.35 23.80,90.35 23.70)))';
const boundaryB = 'SRID=4326;MULTIPOLYGON(((91.70 22.20,91.90 22.20,91.90 22.40,91.70 22.40,91.70 22.20)))';
beforeAll(async () => {
  await asSuper(u.privileged, async c => {
    await c.query('INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now()),($3,$4,now())', [a, 'RLS Test A', b, 'RLS Test B']);
    await c.query('INSERT INTO "Session"(id,"userId","tokenHash","expiresAt","idleExpiresAt","authVersion") VALUES ($1,$2,$3,now()+interval \'1 hour\',now()+interval \'15 minutes\',1)', [randomUUID(), a, tokenHashA]);
    await c.query('INSERT INTO "BoundaryVersion"(id,"ownerType","ownerId",version,boundary,source,"validFrom","contentHash") VALUES ($1,\'ZONE\',$2,1,ST_GeomFromEWKT($3),\'integration-test\',now(),$4)', [randomUUID(), a, boundaryA, 'hash-a']);
    await c.query('INSERT INTO "BoundaryVersion"(id,"ownerType","ownerId",version,boundary,source,"validFrom","contentHash") VALUES ($1,\'ZONE\',$2,1,ST_GeomFromEWKT($3),\'integration-test\',now(),$4)', [randomUUID(), b, boundaryB, 'hash-b']);
    await c.query('INSERT INTO "AuditLog"(id,"actorId","actorType",action,"resourceType","scopeSnapshot","requestId") VALUES ($1,$2,\'USER\',\'test.insert\',\'Test\',\'{}\'::jsonb,$3)', [randomUUID(), a, 'req-test']);
    await c.query('INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType",payload) VALUES ($1,\'Test\',$2,$3,\'test.created\',\'{}\'::jsonb)', [randomUUID(), a, `test-${a}`]);
  });
});
describe('real PostgreSQL/PostGIS + RLS', () => {
  it('runtime role has no superuser or BYPASSRLS', async () => {
    await withClient(u.runtime, async c => {
      const r = await c.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
      expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    });
  });
  it('PostGIS is installed and spatial query returns the containing zone', async () => {
    await withClient(u.runtime, async c => {
      const v = await c.query('SELECT postgis_version()');
      expect(String(v.rows[0].postgis_version)).toContain('3.');
      const r = await c.query('SELECT "ownerId" FROM "BoundaryVersion" WHERE ST_Contains(boundary, ST_SetSRID(ST_MakePoint(90.40,23.75),4326))');
      expect(r.rows.map(x => x.ownerId)).toContain(a);
      expect(r.rows.map(x => x.ownerId)).not.toContain(b);
    });
  });
  it('invalid geometry is rejected by CHECK constraint', async () => {
    await expect(asSuper(u.privileged, c => c.query('INSERT INTO "BoundaryVersion"(id,"ownerType","ownerId",version,boundary,source,"validFrom","contentHash") VALUES ($1,\'ZONE\',$2,99,ST_GeomFromEWKT(\'SRID=4326;MULTIPOLYGON(((0 0,1 1,1 0,0 1,0 0)))\'),\'test\',now(),\'bad\')', [randomUUID(), a]))).rejects.toThrow();
  });
  it('unscoped runtime reads no protected user/session rows', async () => {
    await withClient(u.runtime, async c => {
      expect((await c.query('SELECT id FROM "User"')).rowCount).toBe(0);
      expect((await c.query('SELECT id FROM "Session"')).rowCount).toBe(0);
    });
  });
  it('runtime cannot self-elevate with app.is_super', async () => {
    await withClient(u.runtime, async c => {
      await c.query("SELECT set_config('app.is_super','true',true)");
      expect((await c.query('SELECT id FROM "User"')).rowCount).toBe(0);
    });
  });
  it('self scope sees only own user and session', async () => {
    await asUser(u.runtime, a, async c => {
      const users = await c.query('SELECT id FROM "User"');
      expect(users.rows.map(r => r.id)).toEqual([a]);
      const sessions = await c.query('SELECT "userId" FROM "Session"');
      expect(sessions.rows.every(r => r.userId === a)).toBe(true);
    });
  });
  it('session token-hash lookup works before actor id is known', async () => {
    await withClient(u.runtime, async c => {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.session_token_hash',$1,true)", [tokenHashA]);
      const r = await c.query('SELECT "userId" FROM "Session"');
      expect(r.rows[0].userId).toBe(a);
      await c.query('COMMIT');
    });
  });
  it('audit log update reaches append-only trigger and is rejected', async () => {
    await expect(asSuper(u.privileged, c => c.query('UPDATE "AuditLog" SET action=\'tampered\' WHERE "actorId"=$1', [a]))).rejects.toThrow(/append_only/);
  });
  it('runtime and privileged roles cannot delete audit rows', async () => {
    await expect(asUser(u.runtime, a, c => c.query('DELETE FROM "AuditLog" WHERE "actorId"=$1', [a]))).rejects.toThrow(/permission denied/);
    await expect(asSuper(u.privileged, c => c.query('DELETE FROM "AuditLog" WHERE "actorId"=$1', [a]))).rejects.toThrow(/permission denied/);
  });
  it('outbox delete is blocked for owner by trigger and for runtime by privilege', async () => {
    await expect(withClient(u.owner, c => c.query('DELETE FROM "OutboxEvent" WHERE "aggregateId"=$1', [a]))).rejects.toThrow(/append_only/);
    await expect(asSuper(u.privileged, c => c.query('DELETE FROM "OutboxEvent" WHERE "aggregateId"=$1', [a]))).rejects.toThrow(/permission denied/);
  });
  it('runtime cannot insert admin scope grants', async () => {
    await expect(asUser(u.runtime, a, c => c.query('INSERT INTO "AdminScope"(id,"userId","geographyType","countryId","grantedBy") VALUES ($1,$2,\'COUNTRY\',$3,$4)', [randomUUID(), a, randomUUID(), a]))).rejects.toThrow(/permission denied/);
  });
  it('runtime cannot write RBAC role grants', async () => {
    await expect(asUser(u.runtime, a, c => c.query('INSERT INTO "Role"(id,key,name) VALUES ($1,\'evil\',\'Evil\')', [randomUUID()]))).rejects.toThrow(/permission denied/);
    await expect(asUser(u.runtime, a, c => c.query('INSERT INTO "UserRole"(id,"userId","roleId","grantedBy") VALUES ($1,$2,$3,$4)', [randomUUID(), a, randomUUID(), a]))).rejects.toThrow(/permission denied/);
  });
  it('runtime cannot change own account status or authorization version', async () => {
    await expect(asUser(u.runtime, a, c => c.query('UPDATE "User" SET "authorizationVersion"="authorizationVersion"+1 WHERE id=$1', [a]))).rejects.toThrow(/privileged/);
    await expect(asUser(u.runtime, a, c => c.query('UPDATE "User" SET status=\'SUSPENDED\' WHERE id=$1', [a]))).rejects.toThrow(/privileged/);
  });
});
