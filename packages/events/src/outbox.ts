import type { Pool, PoolClient } from 'pg';
import type { Queue } from 'bullmq';
import { parseEventEnvelope } from './envelope.js';

export interface OutboxOptions {
  maxAttempts: number;
  batchSize: number;
  queueName: string;
  /** Visibility lease in milliseconds. A crashed publisher's row becomes claimable after this window. */
  leaseMs?: number;
}

export interface OutboxRow {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventKey: string;
  eventType: string;
  payload: unknown;
  occurredAt: Date;
  attempts: number;
  leaseToken: string;
}

export interface OutboxPublishResult {
  claimed: number;
  published: number;
  failed: number;
  /** The worker no longer owned the lease when it tried to finalize the row. */
  fenced: number;
}

const DEFAULT_LEASE_MS = 30_000;
const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 300_000;

function validateOptions(opts: OutboxOptions): Required<Pick<OutboxOptions, 'leaseMs'>> & OutboxOptions {
  if (!Number.isInteger(opts.batchSize) || opts.batchSize < 1 || opts.batchSize > 100) {
    throw new Error('OUTBOX_BATCH_SIZE_OUT_OF_RANGE');
  }
  if (!Number.isInteger(opts.maxAttempts) || opts.maxAttempts < 1 || opts.maxAttempts > 20) {
    throw new Error('OUTBOX_MAX_ATTEMPTS_OUT_OF_RANGE');
  }
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
  if (!Number.isInteger(leaseMs) || leaseMs < MIN_LEASE_MS || leaseMs > MAX_LEASE_MS) {
    throw new Error('OUTBOX_LEASE_MS_OUT_OF_RANGE');
  }
  if (!opts.queueName || opts.queueName.length > 200 || opts.queueName.includes(':')) {
    throw new Error('OUTBOX_QUEUE_NAME_INVALID');
  }
  return { ...opts, leaseMs };
}

export function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempts - 1));
}

/**
 * Atomically claim a batch and attach a durable fencing token.
 * The row lock is held only for the claim transaction; the lease protects the
 * subsequent Redis enqueue window. A stale worker cannot finalize a row whose
 * lease expired or was reclaimed by another publisher.
 */
export async function claimOutboxBatch(client: PoolClient, opts: OutboxOptions): Promise<OutboxRow[]> {
  const o = validateOptions(opts);
  // A publisher that crashed after consuming its final attempt must not lease forever.
  // Dead-letter exhausted, due rows before claiming a fresh batch.
  await client.query(
    `WITH exhausted AS (
       SELECT id FROM "OutboxEvent"
       WHERE "publishedAt" IS NULL AND "failedAt" IS NULL
         AND "availableAt" <= now() AND attempts >= $2
         AND ("leaseUntil" IS NULL OR "leaseUntil" <= now())
       ORDER BY "occurredAt"
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE "OutboxEvent" o
     SET "failedAt" = now(), "lastError" = 'OUTBOX_ATTEMPTS_EXHAUSTED',
         "leaseToken" = NULL, "leaseUntil" = NULL
     FROM exhausted e WHERE o.id = e.id`,
    [o.batchSize, o.maxAttempts],
  );
  const r = await client.query(
    `WITH candidate AS (
       SELECT id FROM "OutboxEvent"
       WHERE "publishedAt" IS NULL
         AND "failedAt" IS NULL
         AND "availableAt" <= now()
         AND ("leaseUntil" IS NULL OR "leaseUntil" <= now())
       ORDER BY "occurredAt"
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE "OutboxEvent" o
     SET attempts = o.attempts + 1,
         "leaseToken" = gen_random_uuid(),
         "leaseUntil" = now() + ($2::double precision * interval '1 millisecond')
     FROM candidate c
     WHERE o.id = c.id
     RETURNING o.id, o."aggregateType", o."aggregateId", o."eventKey", o."eventType",
               o.payload, o."occurredAt", o.attempts, o."leaseToken"`,
    [o.batchSize, o.leaseMs],
  );
  return r.rows as OutboxRow[];
}

async function markPublished(pool: Pool, row: OutboxRow): Promise<boolean> {
  const r = await pool.query(
    `UPDATE "OutboxEvent"
     SET "publishedAt" = now(), "lastError" = NULL, "leaseToken" = NULL, "leaseUntil" = NULL
     WHERE id = $1 AND "leaseToken" = $2 AND "leaseUntil" > now()
       AND "publishedAt" IS NULL AND "failedAt" IS NULL
     RETURNING id`,
    [row.id, row.leaseToken],
  );
  return (r.rowCount ?? 0) > 0;
}

async function releaseFailedLease(pool: Pool, row: OutboxRow, message: string, maxAttempts: number): Promise<boolean> {
  const delay = retryDelayMs(row.attempts);
  const r = await pool.query(
    `UPDATE "OutboxEvent"
     SET "lastError" = $3,
         "availableAt" = now() + ($4::double precision * interval '1 millisecond'),
         "failedAt" = CASE WHEN attempts >= $5 THEN now() ELSE NULL END,
         "leaseToken" = NULL,
         "leaseUntil" = NULL
     WHERE id = $1 AND "leaseToken" = $2 AND "leaseUntil" > now()
       AND "publishedAt" IS NULL AND "failedAt" IS NULL
     RETURNING id`,
    [row.id, row.leaseToken, message, delay, maxAttempts],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function publishOutboxBatch(pool: Pool, queue: Queue, opts: OutboxOptions): Promise<OutboxPublishResult> {
  const o = validateOptions(opts);
  let rows: OutboxRow[] = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    rows = await claimOutboxBatch(client, o);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const result: OutboxPublishResult = { claimed: rows.length, published: 0, failed: 0, fenced: 0 };
  for (const row of rows) {
    try {
      const env = parseEventEnvelope(row.payload);
      if (
        env.eventKey !== row.eventKey ||
        env.eventType !== row.eventType ||
        env.aggregateType !== row.aggregateType ||
        env.aggregateId !== row.aggregateId ||
        env.occurredAt !== row.occurredAt.toISOString()
      ) {
        throw new Error('OUTBOX_ENVELOPE_MISMATCH');
      }
      await queue.add(row.eventType, env, {
        jobId: row.eventKey,
        attempts: o.maxAttempts,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400 },
      });
      if (await markPublished(pool, row)) result.published++;
      else result.fenced++;
    } catch (e) {
      // Do not persist raw driver/Redis exception text; it may contain connection details.
      const message = e instanceof Error && e.message === 'OUTBOX_ENVELOPE_MISMATCH'
        ? 'OUTBOX_ENVELOPE_MISMATCH'
        : 'OUTBOX_ENQUEUE_FAILED';
      if (await releaseFailedLease(pool, row, message, o.maxAttempts)) result.failed++;
      else result.fenced++;
    }
  }
  return result;
}
