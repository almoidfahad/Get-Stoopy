import 'dotenv/config';
import pg from 'pg';
export function urls() {
  const runtime = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  const privileged = process.env['TEST_DATABASE_PRIVILEGED_URL'] ?? process.env['DATABASE_PRIVILEGED_URL'];
  const owner = process.env['TEST_DATABASE_MIGRATION_URL'] ?? process.env['DATABASE_MIGRATION_URL'];
  if (!runtime || !privileged || !owner) throw new Error('TEST_DATABASE_URL, TEST_DATABASE_PRIVILEGED_URL and TEST_DATABASE_MIGRATION_URL are required');
  return { runtime, privileged, owner };
}
export async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
export async function asUser<T>(url: string, userId: string, fn: (c: pg.Client) => Promise<T>, authVersion = 1): Promise<T> {
  return withClient(url, async c => {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.user_id',$1,true)", [userId]);
    await c.query("SELECT set_config('app.auth_version',$1,true)", [String(authVersion)]);
    await c.query("SELECT set_config('app.is_super','false',true)");
    try { const r = await fn(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK'); throw e; }
  });
}
export async function asSuper<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  return withClient(url, async c => {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.is_super','true',true)");
    try { const r = await fn(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK'); throw e; }
  });
}

/**
 * Give a fixture store approved delivery coverage.
 *
 * Checkout requires the destination city to be served by every store in the cart,
 * so a store fixture is incomplete without an APPROVED service area in an ACTIVE
 * zone. Approval goes through the API with a separate reviewer because the service
 * forbids self-review; inserting an APPROVED row directly would test nothing.
 */
export async function approveStoreCoverage(
  deps: {
    privilegedUrl: string;
    cityId: string;
    storeId: string;
    owner: any;
    makeUser: (label: string) => Promise<any>;
    grantKeys: (user: any, keys: string[]) => Promise<void>;
    post: (path: string, user: any, body?: unknown) => any;
  },
  label = 'coverage',
): Promise<{ zoneId: string; serviceAreaId: string }> {
  const { randomUUID } = await import('node:crypto');
  const zoneId = await asSuper(deps.privilegedUrl, async c =>
    (await c.query(
      `INSERT INTO "ServiceZone"(id,"cityId",code,name,status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`,
      [randomUUID(), deps.cityId, `zone-${randomUUID().slice(0, 8)}`, 'Coverage Zone'],
    )).rows[0].id as string);
  const admin = await deps.makeUser(`coverage-admin-${label}-${randomUUID().slice(0, 6)}`);
  await deps.grantKeys(admin, ['catalog:store:serviceability:review']);
  const area = await deps.post(`/api/v1/catalog/stores/${deps.storeId}/service-areas`, deps.owner, { serviceZoneId: zoneId }).expect(201);
  await deps.post(`/api/v1/catalog/admin/service-areas/${area.body.serviceAreaId}/review`, admin, {
    version: 1, decision: 'APPROVE', reason: 'fixture coverage approved',
  }).expect(201);
  return { zoneId, serviceAreaId: area.body.serviceAreaId as string };
}
