import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CA_ENV,
  QUERIES,
  REQUIRED_ROLES,
  URL_ENV,
  describeTarget,
  evaluatePreflight
} from '../../../scripts/supabase-preflight.mjs';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const script = fileURLToPath(new URL('scripts/supabase-preflight.mjs', root));
const source = read('scripts/supabase-preflight.mjs');
const SECRET = 'sup3r-s3cret-do-not-print';
const directUrl = `postgresql://postgres:${SECRET}@db.exampleprojectref.supabase.co:5432/postgres`;

function runCli(overrides: Record<string, string | undefined>) {
  const env = { ...process.env };
  delete env[URL_ENV];
  delete env[CA_ENV];
  delete env.NODE_ENV;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
}

function facts(overrides: Record<string, unknown> = {}) {
  return {
    extensions: [{ extname: 'postgis', extversion: '3.4.3' }],
    postgisAvailability: [{ name: 'postgis' }],
    publicTables: 0,
    migrationTable: 0,
    rlsTables: 0,
    roles: REQUIRED_ROLES.map((rolname) => ({ rolname })),
    superuserFlags: REQUIRED_ROLES.map((rolname) => ({ rolname, rolsuper: false, rolbypassrls: false })),
    ...overrides
  };
}

describe('Supabase read-only preflight', () => {
  it('issues only SELECT statements and forces a server-side read-only session', () => {
    for (const sql of Object.values(QUERIES)) {
      expect(sql.trimStart().toLowerCase().startsWith('select')).toBe(true);
      expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|call|do)\b/i);
    }
    expect(source).toContain('default_transaction_read_only=on');
    expect(source).toContain('rejectUnauthorized: true');
    expect(source).not.toContain('rejectUnauthorized: false');
  });

  it('never exposes credentials when describing a target', () => {
    const target = describeTarget(directUrl);
    expect(target).toEqual({
      host: 'db.exampleprojectref.supabase.co',
      port: 5432,
      database: 'postgres',
      pooled: false,
      transactionPooler: false,
      direct: true
    });
    expect(JSON.stringify(target)).not.toContain(SECRET);
    expect(JSON.stringify(target)).not.toContain('postgres:');
  });

  it('fails closed for missing, malformed and non-Supabase targets', () => {
    expect(() => describeTarget('')).toThrow(URL_ENV);
    expect(() => describeTarget(undefined as unknown as string)).toThrow(URL_ENV);
    expect(() => describeTarget('not-a-url')).toThrow('not a valid PostgreSQL URL');
    expect(() => describeTarget('https://db.example.supabase.co')).toThrow('postgresql://');
    expect(() => describeTarget('postgresql://u:p@localhost:5432/postgres')).toThrow('restricted to');
    expect(() => describeTarget('postgresql://u:p@evil-supabase.co.attacker.test:5432/postgres')).toThrow('restricted to');
  });

  it('classifies pooler modes and blocks transaction-mode migration use', () => {
    const session = describeTarget('postgresql://u:p@aws-0-region.pooler.supabase.com:5432/postgres');
    expect(session.pooled).toBe(true);
    expect(session.transactionPooler).toBe(false);
    expect(evaluatePreflight({ target: session, facts: facts() }).warnings.join(' ')).toContain('Session-mode pooler');

    const transaction = describeTarget('postgresql://u:p@aws-0-region.pooler.supabase.com:6543/postgres');
    expect(transaction.transactionPooler).toBe(true);
    expect(evaluatePreflight({ target: transaction, facts: facts() }).blockers.join(' ')).toContain('Transaction-mode pooler');
  });

  it('reports a clean development database without inventing readiness', () => {
    const target = describeTarget(directUrl);
    const result = evaluatePreflight({ target, facts: facts() });
    expect(result.blockers).toEqual([]);
    expect(result.notes.join(' ')).toContain('owner-approved plan');
  });

  it('blocks when PostGIS is unavailable or the schema is not Prisma-managed', () => {
    const target = describeTarget(directUrl);
    const missingPostgis = evaluatePreflight({
      target,
      facts: facts({ extensions: [], postgisAvailability: [] })
    });
    expect(missingPostgis.blockers.join(' ')).toContain('PostGIS is neither installed nor available');

    const unmanaged = evaluatePreflight({ target, facts: facts({ publicTables: 12, migrationTable: 0 }) });
    expect(unmanaged.blockers.join(' ')).toContain('not Prisma-managed');

    const pendingExtension = evaluatePreflight({ target, facts: facts({ extensions: [] }) });
    expect(pendingExtension.blockers).toEqual([]);
    expect(pendingExtension.warnings.join(' ')).toContain('separate owner approval');
  });

  it('warns about missing least-privileged roles and privileged runtime roles', () => {
    const target = describeTarget(directUrl);
    const result = evaluatePreflight({
      target,
      facts: facts({
        roles: [{ rolname: 'gs_owner' }],
        superuserFlags: [{ rolname: 'gs_owner', rolsuper: true, rolbypassrls: true }],
        publicTables: 5,
        migrationTable: 1,
        rlsTables: 0
      })
    });
    expect(result.warnings.join(' ')).toContain('gs_runtime');
    expect(result.warnings.join(' ')).toContain('superuser/BYPASSRLS');
    expect(result.warnings.join(' ')).toContain('No RLS-enabled tables');
  });

  it('refuses to run without configuration, against foreign hosts, or in production', () => {
    const missing = runCli({});
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain(URL_ENV);

    const production = runCli({ [URL_ENV]: directUrl, NODE_ENV: 'production' });
    expect(production.status).toBe(1);
    expect(production.stderr).toContain('not a production tool');
    expect(production.stderr).not.toContain(SECRET);

    const foreign = runCli({ [URL_ENV]: `postgresql://u:${SECRET}@localhost:5432/postgres` });
    expect(foreign.status).toBe(1);
    expect(foreign.stderr).toContain('restricted to');
    expect(foreign.stderr).not.toContain(SECRET);
  });

  it('is wired as an explicit script and keeps the credential out of the committed template', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['db:preflight:supabase']).toBe('node scripts/supabase-preflight.mjs');

    const template = read('.env.example');
    expect(template).toContain(`${URL_ENV}=`);
    expect(template).not.toMatch(/SUPABASE_DEV_DATABASE_URL=postgresql:\/\/\S+:\S+@/);
    expect(read('.gitignore')).toContain('.env');
  });
});
