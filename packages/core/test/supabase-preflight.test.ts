import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  CA_ENV,
  buildClientOptions,
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
      projectRef: null,
      region: null,
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

  it.each([
    '?host=attacker.invalid', '?port=1', '?sslmode=disable', '?sslmode=no-verify',
    '?sslmode=require', '?ssl=no-verify', '?sslrootcert=/etc/passwd',
    '?options=-c%20default_transaction_read_only%3Doff',
    '?sslmode=verify-full&host=attacker.invalid', '?sslmode=verify-full&sslmode=disable',
    '?uselibpqcompat=true', '#fragment',
  ])('rejects URL override %s before any connection is attempted', suffix => {
    expect(() => describeTarget(directUrl + suffix)).toThrow('Refusing URL parameters');
    const result = runCli({ [URL_ENV]: directUrl + suffix });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refusing URL parameters');
    expect(result.stderr).not.toContain(SECRET);
  });

  it('keeps the checked host, verified TLS and read-only options despite hostile PG defaults', () => {
    const original = { PGHOST: process.env.PGHOST, PGSSLMODE: process.env.PGSSLMODE, PGOPTIONS: process.env.PGOPTIONS };
    try {
      process.env.PGHOST = 'attacker.invalid';
      process.env.PGSSLMODE = 'no-verify';
      process.env.PGOPTIONS = '-c default_transaction_read_only=off';
      const options = buildClientOptions(directUrl + '?sslmode=verify-full', 'example-CA');
      expect(options).not.toHaveProperty('connectionString');
      const params = new pg.Client(options).connectionParameters;
      expect(params.host).toBe('db.exampleprojectref.supabase.co');
      expect(params.port).toBe(5432);
      expect(params.database).toBe('postgres');
      expect(params.ssl).toEqual({ rejectUnauthorized: true, ca: 'example-CA' });
      expect(params.options).toContain('default_transaction_read_only=on');
      expect(params.options).toContain('statement_timeout=15000');
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('requires explicit URL credentials instead of inheriting PostgreSQL environment defaults', () => {
    expect(() => buildClientOptions('postgresql://db.exampleprojectref.supabase.co/postgres')).toThrow('must include a user and password');
    expect(() => buildClientOptions('postgresql://postgres@db.exampleprojectref.supabase.co/postgres')).toThrow('must include a user and password');
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

  it('reads the project-scoped pooler role and region without keeping the password', () => {
    const poolerUrl = `postgresql://postgres.exampleprojectref:${SECRET}@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`;
    const target = describeTarget(poolerUrl);
    expect(target.projectRef).toBe('exampleprojectref');
    expect(target.region).toBe('ap-northeast-2');
    expect(target.transactionPooler).toBe(true);
    expect(JSON.stringify(target)).not.toContain(SECRET);

    const result = evaluatePreflight({ target, facts: facts() });
    expect(result.blockers.join(' ')).toContain('session-mode pooler on port 5432');
    expect(result.notes.join(' ')).toContain('ap-northeast-2');
    expect(result.notes.join(' ')).toContain('data-residency');

    const sessionTarget = describeTarget(
      `postgresql://postgres.exampleprojectref:${SECRET}@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`
    );
    const sessionResult = evaluatePreflight({ target: sessionTarget, facts: facts() });
    expect(sessionResult.blockers).toEqual([]);
    expect(sessionResult.notes.join(' ')).toContain('migration-capable endpoint');
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
