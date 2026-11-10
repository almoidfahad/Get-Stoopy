import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { urls, withClient } from './helpers';

const sql = readFileSync(new URL('../../scripts/db-grants.sql', import.meta.url), 'utf8');
const { owner, runtime } = urls();
// This test creates and drops tables and reruns grants. Never allow a remote or
// non-fixture database, even if a developer accidentally exports a live URL.
for (const connection of [owner, runtime]) {
  const target = new URL(connection);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/getstoopy_test') {
    throw new Error('Grant isolation tests require the local disposable getstoopy_test database');
  }
}

describe('grant script isolation (disposable integration database only)', () => {
  it('does not change unrelated owner tables or grant access to later tables; can be rerun', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const existing = `other_app_${suffix}`;
    const future = `future_other_${suffix}`;
    await withClient(owner, async c => {
      try {
        await c.query(`CREATE TABLE public."${existing}" (id integer)`);
        await c.query(`GRANT SELECT ON public."${existing}" TO gs_runtime`);
        const snapshot = async (name: string) => (await c.query(`SELECT has_table_privilege('gs_runtime', $1, 'SELECT') AS r_select, has_table_privilege('gs_privileged', $1, 'SELECT') AS p_select, has_table_privilege('gs_privileged', $1, 'INSERT') AS p_insert`, [`public."${name}"`])).rows[0];
        const before = await snapshot(existing);
        expect(before).toEqual({ r_select: true, p_select: false, p_insert: false });
        await c.query(sql); await c.query(sql);
        expect(await snapshot(existing)).toEqual(before);
        await c.query(`CREATE TABLE public."${future}" (id integer)`);
        expect(await snapshot(future)).toEqual({ r_select: false, p_select: false, p_insert: false });
        const app = (await c.query(`SELECT has_table_privilege('gs_runtime', 'public."Product"', 'SELECT') AS r_select, has_table_privilege('gs_privileged', 'public."Product"', 'INSERT') AS p_insert`)).rows[0];
        expect(app).toEqual({ r_select: true, p_insert: true });
      } finally { await c.query('ROLLBACK'); await c.query(`DROP TABLE IF EXISTS public."${existing}", public."${future}"`); }
    });
  });
  it('refuses the runtime role and rejects a missing inventory table', async () => {
    await withClient(runtime, async c => {
      await expect(c.query(sql)).rejects.toThrow('db-grants must run as gs_owner');
      await c.query('ROLLBACK');
    });
    await withClient(owner, async c => {
      const broken = sql.replace("'AdminActivation',", "'not_a_real_app_table',");
      await expect(c.query(broken)).rejects.toThrow('missing or incorrectly owned Get Stoopy table');
      await c.query('ROLLBACK');
    });
  });
  it('rolls back prior grants if a later statement fails', async () => {
    const table = `rollback_${randomUUID().replaceAll('-', '')}`;
    await withClient(owner, async c => {
      try {
        await c.query(`CREATE TABLE public."${table}" (id integer)`);
        const injected = sql.replace(/COMMIT;\s*$/, `GRANT SELECT ON public."${table}" TO gs_privileged; SELECT 1/0; COMMIT;`);
        await expect(c.query(injected)).rejects.toThrow();
        await c.query('ROLLBACK');
        expect((await c.query(`SELECT has_table_privilege('gs_privileged', $1, 'SELECT') AS allowed`, [`public."${table}"`])).rows[0].allowed).toBe(false);
      } finally { await c.query('ROLLBACK'); await c.query(`DROP TABLE IF EXISTS public."${table}"`); }
    });
  });
});
