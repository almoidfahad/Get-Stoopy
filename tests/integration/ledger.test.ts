import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createLedgerAccount, postJournal } from '../../packages/ledger/src/index';
import { urls, withClient } from './helpers';

const u = urls();
let pool: pg.Pool;
let privileged: pg.Pool;
let actorId: string;
let cashId: string;
let revenueId: string;

async function asSuperClient<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await privileged.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.is_super','true',true)");
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: u.runtime, max: 2 });
  privileged = new pg.Pool({ connectionString: u.privileged, max: 4 });
  actorId = randomUUID();
  await withClient(u.privileged, async c => {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.is_super','true',true)");
    await c.query('INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())', [actorId, 'Ledger Test Actor']);
    await c.query('COMMIT');
  });
  const accounts = await asSuperClient(async c => {
    const cash = await createLedgerAccount(c, { code: `test-cash-${randomUUID()}`, name: 'Test Cash', type: 'ASSET', currency: 'BDT', createdByUserId: actorId });
    const revenue = await createLedgerAccount(c, { code: `test-revenue-${randomUUID()}`, name: 'Test Revenue', type: 'REVENUE', currency: 'BDT', createdByUserId: actorId });
    return { cash, revenue };
  });
  cashId = accounts.cash.accountId;
  revenueId = accounts.revenue.accountId;
});
afterAll(async () => { await pool.end(); await privileged.end(); });

function journal(key: string) {
  return { businessEventKey: key, currency: 'BDT', description: 'integration test journal', createdByUserId: actorId, lines: [{ accountId: cashId, side: 'DEBIT' as const, amountMinor: 1050n }, { accountId: revenueId, side: 'CREDIT' as const, amountMinor: 1050n }] };
}

describe('immutable double-entry ledger persistence', () => {
  it('posts a balanced journal and deduplicates the same business event payload', async () => {
    const key = `ledger-${randomUUID()}`;
    const first = await asSuperClient(c => postJournal(c, journal(key)));
    const second = await asSuperClient(c => postJournal(c, journal(key)));
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.journalId).toBe(first.journalId);
    const lines = await asSuperClient(c => c.query('SELECT side, "amountMinor" FROM "LedgerLine" WHERE "journalId"=$1 ORDER BY "lineNo"', [first.journalId]));
    expect(lines.rowCount).toBe(2);
    expect(lines.rows[0].amountMinor).toBe('1050');
  });
  it('rejects the same business event key with a different payload', async () => {
    const key = `ledger-${randomUUID()}`;
    await asSuperClient(c => postJournal(c, journal(key)));
    await expect(asSuperClient(c => postJournal(c, { ...journal(key), description: 'changed' }))).rejects.toThrow('LEDGER_IDEMPOTENCY_CONFLICT');
  });
  it('rolls back an unbalanced journal at commit', async () => {
    const key = `ledger-${randomUUID()}`;
    await expect(asSuperClient(async c => {
      const r = await postJournal(c, { ...journal(key), lines: [{ accountId: cashId, side: 'DEBIT', amountMinor: 100n }, { accountId: revenueId, side: 'CREDIT', amountMinor: 99n }] });
      return r;
    })).rejects.toThrow('LEDGER_UNBALANCED');
    const exists = await asSuperClient(c => c.query('SELECT 1 FROM "LedgerJournal" WHERE "businessEventKey"=$1', [key]));
    expect(exists.rowCount).toBe(0);
  });
  it('enforces balance at the database layer even without helper validation', async () => {
    const key = `ledger-${randomUUID()}`;
    await expect(asSuperClient(async c => {
      const j = await c.query('INSERT INTO "LedgerJournal"(id,"businessEventKey","payloadHash",currency,description,"createdByUserId") VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [randomUUID(), key, 'x'.repeat(64), 'BDT', 'raw unbalanced', actorId]);
      const id = j.rows[0].id;
      await c.query('INSERT INTO "LedgerLine"(id,"journalId","accountId",side,"amountMinor","lineNo") VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, cashId, 'DEBIT', '100', 1]);
      await c.query('INSERT INTO "LedgerLine"(id,"journalId","accountId",side,"amountMinor","lineNo") VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, revenueId, 'CREDIT', '99', 2]);
    })).rejects.toThrow('ledger_journal_unbalanced');
  });
  it('denies ledger UPDATE/DELETE and runtime direct access', async () => {
    const key = `ledger-${randomUUID()}`;
    const posted = await asSuperClient(c => postJournal(c, journal(key)));
    // Privileged role has no UPDATE/DELETE grant; even if a grant were added, append-only triggers remain.
    await expect(asSuperClient(c => c.query('UPDATE "LedgerJournal" SET description=$1 WHERE id=$2', ['edited', posted.journalId]))).rejects.toThrow(/permission denied|append_only/);
    await expect(asSuperClient(c => c.query('DELETE FROM "LedgerLine" WHERE "journalId"=$1', [posted.journalId]))).rejects.toThrow(/permission denied|append_only/);
    await expect(pool.query('SELECT 1 FROM "LedgerJournal"')).rejects.toThrow(/permission denied/);
    await expect(pool.query('INSERT INTO "LedgerAccount"(id,code,name,type,currency,"createdByUserId") VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), `runtime-${randomUUID()}`, 'Runtime', 'ASSET', 'BDT', actorId])).rejects.toThrow(/permission denied/);
  });
  it('rejects currency mismatch between account and journal', async () => {
    const usd = await asSuperClient(c => createLedgerAccount(c, { code: `test-usd-${randomUUID()}`, name: 'Test USD', type: 'ASSET', currency: 'USD', createdByUserId: actorId }));
    const key = `ledger-${randomUUID()}`;
    await expect(asSuperClient(c => postJournal(c, { ...journal(key), lines: [{ accountId: usd.accountId, side: 'DEBIT', amountMinor: 100n }, { accountId: revenueId, side: 'CREDIT', amountMinor: 100n }] }))).rejects.toThrow(/ledger_currency_mismatch/);
  });
});
