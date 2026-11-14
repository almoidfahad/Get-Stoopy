import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { readRolePasswords, requireLocalTarget, setupDbRoles } from '../../../scripts/setup-db-roles.mjs';

const passwords = ["owner' ; DROP TABLE sentinel; --", 'runtime\\with\nnewline', '$gs_roles$privileged'];
const env = { DB_OWNER_PASSWORD: passwords[0], DB_RUNTIME_PASSWORD: passwords[1], DB_PRIVILEGED_PASSWORD: passwords[2] };

describe('disposable database role setup', () => {
  it('accepts literal special characters but rejects missing, empty or NUL passwords', () => {
    expect(readRolePasswords(env)).toEqual(passwords);
    for (const value of ['', undefined, 'bad\0value']) expect(() => readRolePasswords({ ...env, DB_RUNTIME_PASSWORD: value })).toThrow('DB_ROLE_PASSWORDS_REQUIRED');
  });
  it('rejects remote hosts and hidden connection target overrides', () => {
    for (const PGHOST of ['example.org', 'host,localhost', '127.0.0.2', '[::1]', '']) {
      if (PGHOST === '') { expect(() => requireLocalTarget({ PGHOST })).not.toThrow(); continue; }
      expect(() => requireLocalTarget({ PGHOST })).toThrow('DB_ROLE_TARGET_MUST_BE_LOCAL');
    }
    for (const PGHOST of ['localhost', '127.0.0.1', '::1', '/tmp/example-socket']) expect(() => requireLocalTarget({ PGHOST })).not.toThrow();
    for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR']) expect(() => requireLocalTarget({ [key]: 'injected' })).toThrow('DB_ROLE_TARGET_MUST_BE_LOCAL');
  });
  it('uses protocol parameters and one fixed, transaction-scoped role block', async () => {
    const client = { query: vi.fn().mockResolvedValue({}) };
    await setupDbRoles(client, passwords);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', expect.stringContaining('pg_catalog.set_config'), expect.stringContaining('DO $gs_roles$'), 'COMMIT']);
    expect(client.query.mock.calls[1][1]).toEqual(passwords);
    for (const [sql] of client.query.mock.calls) for (const secret of passwords) expect(sql).not.toContain(secret);
    expect(client.query.mock.calls[2][0]).toContain("pg_catalog.format('CREATE ROLE gs_owner LOGIN PASSWORD %L'");
  });
  it('rolls back the transaction on role setup errors without replacing the failure', async () => {
    const fail = new Error('synthetic');
    const client = { query: vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockRejectedValueOnce(fail).mockResolvedValueOnce({}) };
    await expect(setupDbRoles(client, passwords)).rejects.toBe(fail);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', expect.any(String), expect.any(String), 'ROLLBACK']);
  });
  it('reports a rejected CLI target generically without printing passwords', () => {
    const result = spawnSync('bash', ['scripts/setup-db-roles.sh'], { encoding: 'utf8', env: { ...process.env, ...env, PGHOST: 'remote.example', PGSERVICE: '', PGSERVICEFILE: '', PGHOSTADDR: '' } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DB_ROLE_SETUP_FAILED');
    for (const secret of passwords) expect(result.stdout + result.stderr).not.toContain(secret);
  });
});
