#!/usr/bin/env node
import pg from 'pg';
import { pathToFileURL } from 'node:url';

// Passwords are sent as PostgreSQL protocol parameters, never interpolated in
// the SQL sent by Node or placed in command-line arguments. Transaction-local
// settings make them available to the fixed PL/pgSQL block. The server quotes
// them as SQL literals for CREATE/ALTER ROLE. DB server logging and process
// environment visibility still need independent protection.
const setCredentials = `SELECT pg_catalog.set_config('gs_setup.owner_password', $1, true), pg_catalog.set_config('gs_setup.runtime_password', $2, true), pg_catalog.set_config('gs_setup.privileged_password', $3, true)`;
const configureRoles = `DO $gs_roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gs_owner') THEN
    EXECUTE pg_catalog.format('CREATE ROLE gs_owner LOGIN PASSWORD %L', pg_catalog.current_setting('gs_setup.owner_password'));
  ELSE
    EXECUTE pg_catalog.format('ALTER ROLE gs_owner LOGIN PASSWORD %L', pg_catalog.current_setting('gs_setup.owner_password'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gs_runtime') THEN
    EXECUTE pg_catalog.format('CREATE ROLE gs_runtime LOGIN PASSWORD %L NOBYPASSRLS', pg_catalog.current_setting('gs_setup.runtime_password'));
  ELSE
    EXECUTE pg_catalog.format('ALTER ROLE gs_runtime LOGIN PASSWORD %L NOBYPASSRLS', pg_catalog.current_setting('gs_setup.runtime_password'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gs_privileged') THEN
    EXECUTE pg_catalog.format('CREATE ROLE gs_privileged LOGIN PASSWORD %L NOBYPASSRLS', pg_catalog.current_setting('gs_setup.privileged_password'));
  ELSE
    EXECUTE pg_catalog.format('ALTER ROLE gs_privileged LOGIN PASSWORD %L NOBYPASSRLS', pg_catalog.current_setting('gs_setup.privileged_password'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Suppress dynamic SQL details from the error returned to the client. Server
  -- logging configuration can still expose sensitive values independently.
  RAISE EXCEPTION 'DB_ROLE_SETUP_FAILED';
END
$gs_roles$`;

export function readRolePasswords(env) {
  const values = ['DB_OWNER_PASSWORD', 'DB_RUNTIME_PASSWORD', 'DB_PRIVILEGED_PASSWORD'].map(key => env[key]);
  if (values.some(value => typeof value !== 'string' || value.length === 0 || value.includes('\0'))) {
    throw new Error('DB_ROLE_PASSWORDS_REQUIRED');
  }
  return values;
}

export function requireLocalTarget(env) {
  const host = env.PGHOST || '/var/run/postgresql';
  if (env.PGSERVICE || env.PGSERVICEFILE || env.PGHOSTADDR ||
      (!['localhost', '127.0.0.1', '::1'].includes(host) && !host.startsWith('/')) || host.includes('\0')) {
    throw new Error('DB_ROLE_TARGET_MUST_BE_LOCAL');
  }
  // Local can still contain valuable data: this is not proof of disposability.
}

export async function setupDbRoles(client, passwords) {
  await client.query('BEGIN');
  try {
    await client.query(setCredentials, passwords);
    await client.query(configureRoles);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function main() {
  // Validate before connecting. pg's standard PG* variables select the target;
  // this script changes cluster-wide roles and is for disposable setups only.
  const passwords = readRolePasswords(process.env);
  requireLocalTarget(process.env);
  const client = new pg.Client({ host: process.env.PGHOST || '/var/run/postgresql', database: process.env.PGDATABASE || 'postgres' });
  try {
    await client.connect();
    await setupDbRoles(client, passwords);
    console.log('Database roles configured.');
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Avoid leaking credentials or connection parameters through driver errors.
    console.error('DB_ROLE_SETUP_FAILED: verify the disposable database target, credentials and permissions.');
    process.exitCode = 1;
  });
}
