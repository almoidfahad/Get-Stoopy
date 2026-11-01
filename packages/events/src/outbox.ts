import type { Pool, PoolClient } from 'pg';
import { Queue } from 'bullmq';
import { parseEventEnvelope, type EventEnvelope } from './envelope.js';
export interface OutboxRow { id: string; eventKey: string; eventType: string; payload: unknown; attempts: number; }
export interface OutboxOptions { maxAttempts: number; batchSize: number; queueName: string; }
export function retryDelayMs(attempts: number): number { return Math.min(60_000, 1000 * 2 ** Math.max(0, attempts - 1)); }
export async function claimOutboxBatch(client: PoolClient, opts: OutboxOptions): Promise<OutboxRow[]> {
  const r = await client.query(
    `WITH claimed AS (
       SELECT id FROM "OutboxEvent"
       WHERE "publishedAt" IS NULL AND "failedAt" IS NULL AND "availableAt" <= now() AND attempts < $1
       ORDER BY "occurredAt" LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     UPDATE "OutboxEvent" o SET attempts = o.attempts + 1
     FROM claimed c WHERE o.id = c.id
     RETURNING o.id, o."eventKey", o."eventType", o.payload, o.attempts`,
    [opts.maxAttempts, opts.batchSize]
  );
  return r.rows as OutboxRow[];
}
export async function publishOutboxBatch(pool: Pool, queue: Queue, opts: OutboxOptions): Promise<{ claimed: number; published: number; failed: number }> {
  const client = await pool.connect();
  let rows: OutboxRow[] = [];
  try { await client.query('BEGIN'); rows = await claimOutboxBatch(client, opts); await client.query('COMMIT'); }
  catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
  let published = 0, failed = 0;
  for (const row of rows) {
    try {
      const envelope: EventEnvelope = parseEventEnvelope(row.payload);
      if (envelope.eventKey !== row.eventKey || envelope.eventType !== row.eventType) throw new Error('OUTBOX_ENVELOPE_MISMATCH');
      await queue.add(row.eventType, envelope, { jobId: row.eventKey, attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 86400 } });
      await pool.query('UPDATE "OutboxEvent" SET "publishedAt" = now(), "lastError" = NULL WHERE id = $1', [row.id]);
      published++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message.slice(0, 500) : 'unknown';
      const delay = retryDelayMs(row.attempts);
      await pool.query(`UPDATE "OutboxEvent" SET "lastError" = $2, "availableAt" = now() + ($3 || ' milliseconds')::interval, "failedAt" = CASE WHEN attempts >= $4 THEN now() ELSE NULL END WHERE id = $1`, [row.id, message, String(delay), opts.maxAttempts]);
    }
  }
  return { claimed: rows.length, published, failed };
}
