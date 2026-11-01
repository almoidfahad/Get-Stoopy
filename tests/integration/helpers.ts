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
