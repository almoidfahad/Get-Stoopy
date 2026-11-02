import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { publishOutboxBatch, processWithInbox, parseEventEnvelope } from '../../packages/events/src/index';
import { urls } from './helpers';
const u = urls();
const redisUrl = process.env['TEST_REDIS_URL'] ?? process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const parsed = new URL(redisUrl);
const connection = { host: parsed.hostname, port: Number(parsed.port || 6379), password: parsed.password || undefined, db: Number(parsed.pathname.slice(1) || 0) };
let pool: pg.Pool; let queue: Queue; let redis: Redis;
const queueName = `gs-test-${randomUUID()}`;
beforeAll(() => { pool = new pg.Pool({ connectionString: u.runtime, max: 4 }); redis = new Redis({ ...connection, maxRetriesPerRequest: null }); queue = new Queue(queueName, { connection: redis }); });
afterAll(async () => { await queue.obliterate({ force: true }); await queue.close(); await redis.quit(); await pool.end(); });
function envelope(eventKey: string) { return { schemaVersion: 1 as const, eventKey, eventType: 'test.created', occurredAt: new Date().toISOString(), aggregateType: 'Test', aggregateId: randomUUID(), data: { integration: true } }; }
describe('real outbox/inbox with PostgreSQL and Redis', () => {
  it('publishes an outbox row to BullMQ and marks it published', async () => {
    const eventKey = `evt-${randomUUID()}`; const env = envelope(eventKey);
    await pool.query('INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType",payload,"occurredAt") VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)', [randomUUID(), env.aggregateType, env.aggregateId, eventKey, env.eventType, JSON.stringify(env), new Date(env.occurredAt)]);
    const r = await publishOutboxBatch(pool, queue, { maxAttempts: 5, batchSize: 100, queueName });
    expect(r.published).toBeGreaterThanOrEqual(1);
    const job = await queue.getJob(eventKey); expect(job).toBeTruthy(); expect(job?.data.eventKey).toBe(eventKey);
    const row = await pool.query('SELECT "publishedAt" FROM "OutboxEvent" WHERE "eventKey"=$1', [eventKey]); expect(row.rows[0].publishedAt).toBeTruthy();
  });
  it('deduplicates inbox processing and rolls back failed handlers', async () => {
    const env = envelope(`evt-${randomUUID()}`); const consumer = `test-${randomUUID()}`; let calls = 0;
    const first = await processWithInbox(pool, consumer, env, async () => { calls++; });
    const second = await processWithInbox(pool, consumer, env, async () => { calls++; });
    expect(first).toBe('processed'); expect(second).toBe('duplicate'); expect(calls).toBe(1);
    const failEnv = envelope(`evt-${randomUUID()}`);
    await expect(processWithInbox(pool, consumer, failEnv, async () => { throw new Error('handler failed'); })).rejects.toThrow('handler failed');
    const receipt = await pool.query('SELECT 1 FROM "InboxReceipt" WHERE consumer=$1 AND "eventKey"=$2', [consumer, failEnv.eventKey]); expect(receipt.rowCount).toBe(0);
    const retry = await processWithInbox(pool, consumer, failEnv, async () => { calls++; }); expect(retry).toBe('processed');
  });
  it('rejects envelope/row mismatch before publishing', async () => {
    const eventKey = `evt-${randomUUID()}`; const env = envelope(`other-${randomUUID()}`);
    await pool.query('INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType",payload,"occurredAt") VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)', [randomUUID(), env.aggregateType, env.aggregateId, eventKey, env.eventType, JSON.stringify(env), new Date(env.occurredAt)]);
    const r = await publishOutboxBatch(pool, queue, { maxAttempts: 1, batchSize: 100, queueName }); expect(r.failed).toBeGreaterThanOrEqual(1);
    const row = await pool.query('SELECT "failedAt","lastError" FROM "OutboxEvent" WHERE "eventKey"=$1', [eventKey]); expect(row.rows[0].failedAt).toBeTruthy(); expect(row.rows[0].lastError).toContain('OUTBOX_ENVELOPE_MISMATCH');
  });
});
