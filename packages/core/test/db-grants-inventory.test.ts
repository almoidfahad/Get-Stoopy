import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const root = new URL('../../../', import.meta.url);
const sql = readFileSync(new URL('scripts/db-grants.sql', root), 'utf8');
const schema = readFileSync(new URL('packages/db/prisma/schema.prisma', root), 'utf8');

describe('database grant inventory', () => {
  it('tracks every Prisma model exactly once and excludes the migration ledger', () => {
    const block = sql.match(/app_tables constant text\[\] := ARRAY\[([\s\S]*?)\];/)?.[1];
    expect(block).toBeDefined();
    const tables = [...block!.matchAll(/'([A-Za-z0-9_]+)'/g)].map(m => m[1]);
    const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(m => m[1]);
    expect(new Set(tables).size).toBe(tables.length);
    expect(tables.sort()).toEqual(models.sort());
    expect(tables).not.toContain('_prisma_migrations');
  });
  it('guards role and ownership, uses a transaction, and avoids schema-wide default grants', () => {
    expect(sql).toMatch(/^BEGIN;/m); expect(sql).toMatch(/^COMMIT;\s*$/m);
    expect(sql).toContain("IF current_user <> 'gs_owner'");
    expect(sql).toContain('pg_catalog.pg_get_userbyid(c.relowner) = current_user');
    expect(sql).not.toMatch(/^\s*ALTER DEFAULT PRIVILEGES/im);
    expect(sql).not.toMatch(/FOR\s+\w+\s+IN\s+SELECT\s+tablename\s+FROM\s+pg_tables/i);
  });
});
