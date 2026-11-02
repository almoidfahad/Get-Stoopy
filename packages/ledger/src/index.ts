import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export type LedgerSide = 'DEBIT' | 'CREDIT';
export type LedgerAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export interface LedgerLineInput {
  accountId: string;
  side: LedgerSide;
  amountMinor: bigint;
}

export interface PostJournalInput {
  businessEventKey: string;
  currency: string;
  description: string;
  createdByUserId: string;
  occurredAt?: Date;
  reversalOfJournalId?: string;
  lines: LedgerLineInput[];
}

export interface PostJournalResult {
  journalId: string;
  duplicate: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateJournalInput(input: PostJournalInput): void {
  if (!input.businessEventKey || input.businessEventKey.length > 128) throw new Error('LEDGER_EVENT_KEY_INVALID');
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error('LEDGER_CURRENCY_INVALID');
  if (!input.description || input.description.length > 512) throw new Error('LEDGER_DESCRIPTION_INVALID');
  if (!UUID_RE.test(input.createdByUserId)) throw new Error('LEDGER_ACTOR_INVALID');
  if (input.reversalOfJournalId && !UUID_RE.test(input.reversalOfJournalId)) throw new Error('LEDGER_REVERSAL_INVALID');
  if (!Array.isArray(input.lines) || input.lines.length < 2 || input.lines.length > 100) throw new Error('LEDGER_LINES_INVALID');
  let net = 0n;
  for (const line of input.lines) {
    if (!UUID_RE.test(line.accountId)) throw new Error('LEDGER_ACCOUNT_INVALID');
    if (line.side !== 'DEBIT' && line.side !== 'CREDIT') throw new Error('LEDGER_SIDE_INVALID');
    if (typeof line.amountMinor !== 'bigint' || line.amountMinor <= 0n) throw new Error('LEDGER_AMOUNT_INVALID');
    net += line.side === 'DEBIT' ? line.amountMinor : -line.amountMinor;
  }
  if (net !== 0n) throw new Error('LEDGER_UNBALANCED');
}

export function journalPayloadHash(input: PostJournalInput): string {
  const canonical = {
    businessEventKey: input.businessEventKey,
    currency: input.currency,
    description: input.description,
    reversalOfJournalId: input.reversalOfJournalId ?? null,
    lines: input.lines.map(l => ({ accountId: l.accountId.toLowerCase(), side: l.side, amountMinor: l.amountMinor.toString() })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Persist an immutable balanced journal inside the caller's transaction.
 * The caller must use a privileged database role and set app.is_super=true.
 * Duplicate businessEventKey with the same payload returns the existing journal;
 * a different payload under the same key is rejected.
 */
export async function postJournal(tx: PoolClient, input: PostJournalInput): Promise<PostJournalResult> {
  validateJournalInput(input);
  const payloadHash = journalPayloadHash(input);
  const journalId = randomUUID();
  const inserted = await tx.query(
    `INSERT INTO "LedgerJournal"
       (id, "businessEventKey", "payloadHash", currency, description, "occurredAt", "createdByUserId", "reversalOfJournalId")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT ("businessEventKey") DO NOTHING
     RETURNING id`,
    [journalId, input.businessEventKey, payloadHash, input.currency, input.description, input.occurredAt ?? new Date(), input.createdByUserId, input.reversalOfJournalId ?? null],
  );
  if ((inserted.rowCount ?? 0) === 0) {
    const existing = await tx.query('SELECT id, "payloadHash" FROM "LedgerJournal" WHERE "businessEventKey"=$1', [input.businessEventKey]);
    const row = existing.rows[0] as { id: string; payloadHash: string } | undefined;
    if (!row) throw new Error('LEDGER_IDEMPOTENCY_RACE');
    if (row.payloadHash !== payloadHash) throw new Error('LEDGER_IDEMPOTENCY_CONFLICT');
    return { journalId: row.id, duplicate: true };
  }
  for (let i = 0; i < input.lines.length; i++) {
    const line = input.lines[i]!;
    await tx.query(
      `INSERT INTO "LedgerLine"(id, "journalId", "accountId", side, "amountMinor", "lineNo")
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), journalId, line.accountId, line.side, line.amountMinor.toString(), i + 1],
    );
  }
  return { journalId, duplicate: false };
}

export async function createLedgerAccount(
  tx: PoolClient,
  input: { code: string; name: string; type: LedgerAccountType; currency: string; createdByUserId: string },
): Promise<{ accountId: string }> {
  if (!input.code || input.code.length > 64) throw new Error('LEDGER_ACCOUNT_CODE_INVALID');
  if (!input.name || input.name.length > 128) throw new Error('LEDGER_ACCOUNT_NAME_INVALID');
  if (!['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(input.type)) throw new Error('LEDGER_ACCOUNT_TYPE_INVALID');
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error('LEDGER_CURRENCY_INVALID');
  if (!UUID_RE.test(input.createdByUserId)) throw new Error('LEDGER_ACTOR_INVALID');
  const accountId = randomUUID();
  await tx.query(
    `INSERT INTO "LedgerAccount"(id, code, name, type, currency, "createdByUserId") VALUES ($1,$2,$3,$4,$5,$6)`,
    [accountId, input.code, input.name, input.type, input.currency, input.createdByUserId],
  );
  return { accountId };
}
