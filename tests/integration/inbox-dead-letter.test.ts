import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { StructuredLogger } from '../../packages/observability/src/index';
import { attachInboxDeadLetter, createInboxProcessor, type InboxHandlers } from '../../apps/worker/src/inbox-processing';
import { urls } from './helpers';

const u = urls();
const redisUrl = process.env['TEST_REDIS_URL'] ?? process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const parsed = new URL(redisUrl);
const connection = { host: parsed.hostname, port: Number(parsed.port || 6379), ...(parsed.password ? { password: parsed.password } : {}), db: Number(parsed.pathname.slice(1) || 0) };
let pool: pg.Pool; let redis: Redis; let queue: Queue; let worker: Worker;
const queueName = `gs-dlq-test-${randomUUID()}`;
const consumer = `worker:${queueName}`;
const log = new StructuredLogger(() => undefined);
const handlers: InboxHandlers = new Map();
let failCalls = 0;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: u.runtime, max: 4 });
  redis = new Redis({ ...connection, maxRetriesPerRequest: null });
  queue = new Queue(queueName, { connection: redis });
  handlers.set('test.ok', async () => undefined);
  handlers.set('test.fail', async () => { failCalls++; throw new Error('postgres://user:super-secret@localhost/db'); });
  handlers.set('test.flaky', async () => { failCalls++; if (failCalls < 2) throw new Error('temporary'); });
  worker = new Worker(queueName, createInboxProcessor(pool, consumer, handlers, log), { connection: redis, concurrency: 1 });
  attachInboxDeadLetter(worker, pool, consumer, log);
});
afterAll(async () => {
  await worker.close();
  await queue.obliterate({ force: true });
  await queue.close();
  await redis.quit();
  await pool.end();
});

function envelope(eventType: string) {
  return { schemaVersion: 1 as const, eventKey: `evt-${randomUUID()}`, eventType, occurredAt: new Date().toISOString(), aggregateType: 'Test', aggregateId: randomUUID(), data: { dlqTest: true } };
}
async function waitForDeadLetter(eventKey: string, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const r = await pool.query('SELECT "errorCode", attempts, payload FROM "InboxDeadLetter" WHERE consumer=$1 AND "eventKey"=$2', [consumer, eventKey]);
    if (r.rowCount) return r.rows[0] as { errorCode: string; attempts: number; payload: unknown };
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('DEAD_LETTER_NOT_OBSERVED');
}
async function waitForReceipt(eventKey: string, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const r = await pool.query('SELECT 1 FROM "InboxReceipt" WHERE consumer=$1 AND "eventKey"=$2', [consumer, eventKey]);
    if (r.rowCount) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('RECEIPT_NOT_OBSERVED');
}

describe('terminal inbox failures are durably dead-lettered', () => {
  it('dead-letters an invalid envelope without retrying', async () => {
    const jobId = `invalid-${randomUUID()}`;
    await queue.add('invalid', { notAnEnvelope: true }, { jobId, attempts: 5 });
    const dl = await waitForDeadLetterByPayload(jobId);
    expect(dl.errorCode).toBe('INBOX_ENVELOPE_INVALID');
    expect(dl.attempts).toBe(1);
    const job = await queue.getJob(jobId);
    expect(job?.failedReason).toBe('INBOX_ENVELOPE_INVALID');
  });
  it('dead-letters an unknown event type without retrying', async () => {
    const env = envelope('test.unknown');
    await queue.add(env.eventType, env, { jobId: env.eventKey, attempts: 5 });
    const dl = await waitForDeadLetter(env.eventKey);
    expect(dl.errorCode).toBe('INBOX_HANDLER_NOT_REGISTERED');
    expect(dl.attempts).toBe(1);
    const receipt = await pool.query('SELECT 1 FROM "InboxReceipt" WHERE consumer=$1 AND "eventKey"=$2', [consumer, env.eventKey]);
    expect(receipt.rowCount).toBe(0);
  });
  it('retries handler failure and dead-letters only after final attempt', async () => {
    failCalls = 0;
    const env = envelope('test.fail');
    await queue.add(env.eventType, env, { jobId: env.eventKey, attempts: 2, backoff: { type: 'fixed', delay: 20 } });
    const dl = await waitForDeadLetter(env.eventKey);
    expect(dl.errorCode).toBe('INBOX_HANDLER_FAILED');
    expect(dl.attempts).toBe(2);
    expect(failCalls).toBe(2);
    expect(JSON.stringify(dl)).not.toContain('super-secret');
    const receipt = await pool.query('SELECT 1 FROM "InboxReceipt" WHERE consumer=$1 AND "eventKey"=$2', [consumer, env.eventKey]);
    expect(receipt.rowCount).toBe(0);
    const job = await queue.getJob(env.eventKey);
    expect(job?.failedReason).toBe('INBOX_HANDLER_FAILED');
  });
  it('does not dead-letter a retry that eventually succeeds', async () => {
    failCalls = 0;
    const env = envelope('test.flaky');
    await queue.add(env.eventType, env, { jobId: env.eventKey, attempts: 2, backoff: { type: 'fixed', delay: 20 } });
    await waitForReceipt(env.eventKey);
    await new Promise(resolve => setTimeout(resolve, 100));
    const dl = await pool.query('SELECT 1 FROM "InboxDeadLetter" WHERE consumer=$1 AND "eventKey"=$2', [consumer, env.eventKey]);
    expect(dl.rowCount).toBe(0);
  });
});

async function waitForDeadLetterByPayload(jobId: string) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const r = await pool.query('SELECT "errorCode", attempts, payload FROM "InboxDeadLetter" WHERE consumer=$1 AND payload->>\'notAnEnvelope\' = \'true\'', [consumer]);
    if (r.rowCount) return r.rows[0] as { errorCode: string; attempts: number; payload: unknown };
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`DEAD_LETTER_NOT_OBSERVED:${jobId}`);
}
