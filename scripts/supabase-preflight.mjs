#!/usr/bin/env node
// Read-only Supabase development preflight.
//
// Contract:
//   * Never issues DDL/DML. The server session is forced into
//     `default_transaction_read_only=on`, so a mistake cannot write.
//   * Never prints the connection string, password, or role password hashes.
//   * Fails closed: requires an explicit Supabase host and refuses to run when
//     NODE_ENV=production.
//   * Applies no migration and creates no extension, role, schema or table.
//     Remediation always requires separate owner approval.
//
// Exit codes: 0 = inspected, no blockers; 1 = usage/configuration error;
//             2 = inspected, blockers found (do not migrate).

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const REQUIRED_ROLES = ['gs_owner', 'gs_runtime', 'gs_privileged'];
export const URL_ENV = 'SUPABASE_DEV_DATABASE_URL';
export const CA_ENV = 'SUPABASE_DB_CA_CERT_PATH';

// Every statement below is a SELECT. Keep it that way; a unit test asserts it.
export const QUERIES = Object.freeze({
  identity:
    'select current_database() as database, current_user as role, version() as version',
  extensions:
    "select extname, extversion from pg_extension where extname in ('postgis','pgcrypto','uuid-ossp') order by extname",
  postgisAvailability:
    "select name, default_version, installed_version from pg_available_extensions where name = 'postgis'",
  schemas:
    "select nspname from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' order by nspname",
  publicTables:
    "select count(*)::int as total from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')",
  migrationTable:
    "select count(*)::int as total from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = '_prisma_migrations' and c.relkind in ('r','p')",
  rlsTables:
    "select count(*)::int as total from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity",
  roles:
    'select rolname from pg_roles where rolname = any($1::text[]) order by rolname',
  superuserFlags:
    'select rolname, rolsuper, rolbypassrls from pg_roles where rolname = any($1::text[]) order by rolname'
});

/**
 * Describe a target without ever exposing credentials.
 * @param {string} rawUrl
 */
export function describeTarget(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new Error(`${URL_ENV} is not set. Configure it locally; never commit it.`);
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${URL_ENV} is not a valid PostgreSQL URL.`);
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`${URL_ENV} must use the postgresql:// scheme.`);
  }

  const host = url.hostname.toLowerCase();
  if (!host.endsWith('.supabase.co') && !host.endsWith('.supabase.com')) {
    throw new Error('Refusing to run: preflight is restricted to *.supabase.co / *.supabase.com hosts.');
  }

  const port = Number(url.port || 5432);
  const pooled = host.includes('pooler.');
  const transactionPooler = pooled && port === 6543;

  // Supabase poolers use a project-scoped role: `postgres.<project-ref>`.
  // The reference is an identifier, not a credential; the password is never kept.
  const username = decodeURIComponent(url.username || '');
  const separator = username.indexOf('.');
  const projectRef = separator > 0 ? username.slice(separator + 1) : null;
  const region = pooled ? host.split('.')[0].replace(/^aws-\d+-/, '') : null;

  return {
    host,
    port,
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
    pooled,
    transactionPooler,
    projectRef,
    region,
    // Direct Supabase hostnames are IPv6-only unless an IPv4 add-on is enabled.
    // The session pooler is the documented fallback for IPv4-only networks.
    direct: !pooled
  };
}

/**
 * Turn read-only observations into blockers/warnings. Pure and unit-tested.
 * @param {{target: ReturnType<typeof describeTarget>, facts: any}} input
 */
export function evaluatePreflight({ target, facts }) {
  const blockers = [];
  const warnings = [];
  const notes = [];

  const installed = new Set((facts.extensions ?? []).map((row) => row.extname));
  const postgisAvailable = (facts.postgisAvailability ?? []).length > 0;
  const publicTables = Number(facts.publicTables ?? 0);
  const migrationTable = Number(facts.migrationTable ?? 0) > 0;
  const presentRoles = new Set((facts.roles ?? []).map((row) => row.rolname));

  if (!installed.has('postgis')) {
    if (postgisAvailable) {
      warnings.push('PostGIS is available but not installed. CREATE EXTENSION requires separate owner approval.');
    } else {
      blockers.push('PostGIS is neither installed nor available; geographic queries cannot run.');
    }
  }

  if (publicTables > 0 && !migrationTable) {
    blockers.push('public schema has tables but no _prisma_migrations ledger; this database is not Prisma-managed. Do not migrate.');
  }

  if (publicTables === 0 && !migrationTable) {
    notes.push('Empty database: applying migrations 0001+ still requires an explicit owner-approved plan.');
  }

  if (target.transactionPooler) {
    blockers.push(
      'Transaction-mode pooler (6543) detected. Prisma migrate and SET LOCAL guarantees need a ' +
        'session-mode pooler on port 5432, or a direct connection that is actually reachable.'
    );
  } else if (target.pooled) {
    warnings.push('Session-mode pooler detected. Keep RLS context transaction-local; never use session-level set_config.');
    notes.push('Session-mode pooler on 5432 is the migration-capable endpoint when the direct host is IPv6-only.');
  } else {
    notes.push('Direct connection detected. Verify network reachability (IPv6 or IPv4 add-on) before scheduling migrations.');
  }

  if (target.region) {
    notes.push(`Pooler region: ${target.region}. Confirm latency and data-residency acceptability for a Bangladesh-first pilot.`);
  }

  const missingRoles = REQUIRED_ROLES.filter((role) => !presentRoles.has(role));
  if (missingRoles.length > 0) {
    warnings.push(`Least-privileged roles missing: ${missingRoles.join(', ')}. Role creation requires separate owner approval.`);
  }

  for (const row of facts.superuserFlags ?? []) {
    if (row.rolsuper || row.rolbypassrls) {
      warnings.push(`Role ${row.rolname} is superuser/BYPASSRLS. Never use it as the application runtime role.`);
    }
  }

  if (Number(facts.rlsTables ?? 0) === 0 && publicTables > 0) {
    warnings.push('No RLS-enabled tables found in public; row-level security is not yet applied here.');
  }

  return { blockers, warnings, notes };
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run: preflight is a development tool, not a production tool.');
    return 1;
  }

  let target;
  try {
    target = describeTarget(process.env[URL_ENV]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const ssl = { rejectUnauthorized: true };
  const caPath = process.env[CA_ENV];
  if (caPath) {
    try {
      ssl.ca = readFileSync(caPath, 'utf8');
    } catch {
      console.error(`Cannot read ${CA_ENV}. Provide the Supabase root certificate; TLS verification is never disabled.`);
      return 1;
    }
  }

  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: process.env[URL_ENV],
    ssl,
    connectionTimeoutMillis: 15000,
    // Server-enforced read-only session: a write would be rejected by PostgreSQL.
    options: '-c default_transaction_read_only=on -c statement_timeout=15000'
  });

  try {
    await client.connect();
  } catch {
    // Never echo the driver error: it can embed the connection string.
    console.error('Connection failed. Check host reachability, credentials and TLS root certificate.');
    return 1;
  }

  try {
    const facts = {};
    facts.identity = (await client.query(QUERIES.identity)).rows[0];
    facts.extensions = (await client.query(QUERIES.extensions)).rows;
    facts.postgisAvailability = (await client.query(QUERIES.postgisAvailability)).rows;
    facts.schemas = (await client.query(QUERIES.schemas)).rows.map((row) => row.nspname);
    facts.publicTables = (await client.query(QUERIES.publicTables)).rows[0].total;
    facts.migrationTable = (await client.query(QUERIES.migrationTable)).rows[0].total;
    facts.rlsTables = (await client.query(QUERIES.rlsTables)).rows[0].total;
    facts.roles = (await client.query(QUERIES.roles, [REQUIRED_ROLES])).rows;
    facts.superuserFlags = (await client.query(QUERIES.superuserFlags, [REQUIRED_ROLES])).rows;

    const { blockers, warnings, notes } = evaluatePreflight({ target, facts });

    console.log('Supabase read-only preflight');
    console.log(`  host: ${target.host}`);
    console.log(`  port: ${target.port}`);
    console.log(`  database: ${target.database}`);
    console.log(`  project ref: ${target.projectRef ?? '(not encoded in role)'}`);
    console.log(`  region: ${target.region ?? '(direct host)'}`);
    console.log(`  connected role: ${facts.identity.role}`);
    console.log(`  schemas: ${facts.schemas.join(', ') || '(none)'}`);
    console.log(`  public tables: ${facts.publicTables}`);
    console.log(`  RLS-enabled public tables: ${facts.rlsTables}`);
    console.log(`  _prisma_migrations present: ${facts.migrationTable > 0}`);
    console.log(`  extensions: ${facts.extensions.map((row) => `${row.extname}@${row.extversion}`).join(', ') || '(none)'}`);

    for (const note of notes) console.log(`  note: ${note}`);
    for (const warning of warnings) console.log(`  warning: ${warning}`);
    for (const blocker of blockers) console.log(`  BLOCKER: ${blocker}`);

    console.log('No migration, extension, role or data change was performed.');
    return blockers.length > 0 ? 2 : 0;
  } finally {
    await client.end();
  }
}

const invokedDirectly =
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    () => {
      console.error('Preflight failed unexpectedly. No credentials were logged.');
      process.exit(1);
    }
  );
}
