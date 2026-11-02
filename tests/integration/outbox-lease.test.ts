import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { claimOutboxBatch, publishOutboxBatch } from '../../packages/events/src/index';
import { urls } from './helpers';

const u = urls();
const redisUrl = process.env['TEST_REDIS_URL'] ?? process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const parsed = new URL(redisUrl);
const connection = {
  host: parsed.hostname,
  port: Number(parsed.port || 6379),
  ...(parsed.password ? { password: parsed.password } : {}),
  db: Number(parsed.pathname.slice(1) || 0),
};
let pool: pg.Pool;
let queue: Queue;
let redis: Redis;
const queueName = `gs-lease-test-${randomUUID()}`;
const opts = { maxAttempts: 5, batchSize: 10, queueName, leaseMs: 1000 };

async function drainPendingFixtures() {
  // Test-fixture cleanup in the isolated integration DB only. maxAttempts=1
  // dead-letters invalid/mismatched fixture rows instead of leaving backoff rows.
  for (let i = 0; i < 25; i++) {
    const pending = await pool.query(
      'UPDATE "OutboxEvent" SET "availableAt" = now(), "leaseToken" = NULL, "leaseUntil" = NULL WHERE "publishedAt" IS NULL AND "failedAt" IS NULL RETURNING id',
    );
    if ((pending.rowCount ?? 0) === 0) return;
    await publishOutboxBatch(pool, queue, { ...opts, maxAttempts: 1, batchSize: 100 });
  }
  throw new Error('FIXTURE_DRAIN_FAILED');
}
beforeAll(async () => {
  pool = new pg.Pool({ connectionString: u.runtime, max: 6 });
  redis = new Redis({ ...connection, maxRetriesPerRequest: null });
  queue = new Queue(queueName, { connection: redis });
  await drainPendingFixtures();
});
beforeEach(async () => { await drainPendingFixtures(); });
afterAll(async () => {
  await queue.obliterate({ force: true });
  await queue.close();
  await redis.quit();
  await pool.end();
});

function envelope(eventKey: string) {
  return {
    schemaVersion: 1 as const,
    eventKey,
    eventType: 'test.created',
    occurredAt: new Date().toISOString(),
    aggregateType: 'Test',
    aggregateId: randomUUID(),
    data: { leaseTest: true },
  };
}
async function insertEvent() {
  const eventKey = `evt-${randomUUID()}`;
  const env = envelope(eventKey);
  const id = randomUUID();
  await pool.query(
    'INSERT INTO "OutboxEvent"(id,"aggregateType","aggregateId","eventKey","eventType",payload,"occurredAt") VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)',
    [id, env.aggregateType, env.aggregateId, eventKey, env.eventType, JSON.stringify(env), new Date(env.occurredAt)],
  );
  return { id, eventKey, env };
}
async function row(id: string) {
  const r = await pool.query('SELECT attempts, "publishedAt", "failedAt", "leaseToken", "leaseUntil", "availableAt", "lastError" FROM "OutboxEvent" WHERE id=$1', [id]);
  return r.rows[0] as {
    attempts: number; publishedAt: Date | null; failedAt: Date | null;
    leaseToken: string | null; leaseUntil: Date | null; availableAt: Date; lastError: string | null;
  };
}
async function expireLease(id: string) {
  await pool.query('UPDATE "OutboxEvent" SET "leaseUntil" = now() - interval \'1 millisecond\' WHERE id=$1', [id]);
}
async function dueNow(id: string) {
  await pool.query('UPDATE "OutboxEvent" SET "availableAt" = now() WHERE id=$1', [id]);
}
async function waitForLease(id: string) {
  for (let i = 0; i < 100; i++) {
    const r = await row(id);
    if (r.leaseToken) return r;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('LEASE_NOT_OBSERVED');
}

describe('outbox visibility lease and stale-worker fencing', () => {
  it('allows only one concurrent publisher to claim a due row', async () => {
    const { id, eventKey } = await insertEvent();
    const [a, b] = await Promise.all([
      publishOutboxBatch(pool, queue, { ...opts, batchSize: 1 }),
      publishOutboxBatch(pool, queue, { ...opts, batchSize: 1 }),
    ]);
    expect(a.claimed + b.claimed).toBe(1);
    expect(a.published + b.published).toBe(1);
    const r = await row(id);
    expect(r.attempts).toBe(1);
    expect(r.publishedAt).toBeTruthy();
    expect(r.leaseToken).toBeNull();
    expect(r.leaseUntil).toBeNull();
    expect(await queue.getJob(eventKey)).toBeTruthy();
  });

  it('blocks reclaim during an active lease and recovers after a simulated crash', async () => {
    const { id, eventKey } = await insertEvent();
    const client = await pool.connect();
    let claimed;
    try {
      await client.query('BEGIN');
      claimed = await claimOutboxBatch(client, { ...opts, batchSize: 1 });
      await client.query('COMMIT');
    } finally { client.release(); }
    expect(claimed.some(r => r.id === id)).toBe(true);
    const leased = await row(id);
    expect(leased.leaseToken).toBeTruthy();
    expect(leased.leaseUntil!.getTime()).toBeGreaterThan(Date.now());

    const blocked = await publishOutboxBatch(pool, queue, { ...opts, batchSize: 1 });
    expect(blocked.claimed).toBe(0);
    expect((await row(id)).publishedAt).toBeNull();

    // Simulate the first publisher dying after claim but before Redis enqueue.
    await expireLease(id);
    const recovered = await publishOutboxBatch(pool, queue, { ...opts, batchSize: 1 });
    expect(recovered.claimed).toBe(1);
    expect(recovered.published).toBe(1);
    const r = await row(id);
    expect(r.attempts).toBe(2);
    expect(r.publishedAt).toBeTruthy();
    expect(r.leaseToken).toBeNull();
    expect(await queue.getJob(eventKey)).toBeTruthy();
  });

  it('fences a stale publisher that finishes after a newer lease already published', async () => {
    const { id, eventKey } = await insertEvent();
    let releaseSlowAdd!: () => void;
    const gate = new Promise<void>(resolve => { releaseSlowAdd = resolve; });
    const slowQueue = {
      add: async (...args: Parameters<Queue['add']>) => {
        await gate;
        return queue.add(...args);
      },
    } as unknown as Queue;

    const slow = publishOutboxBatch(pool, slowQueue, { ...opts, batchSize: 1 });
    const firstLease = await waitForLease(id);
    await expireLease(id);
    const newer = await publishOutboxBatch(pool, queue, { ...opts, batchSize: 1 });
    expect(newer.claimed).toBe(1);
    expect(newer.published).toBe(1);
    releaseSlowAdd();
    const stale = await slow;
    expect(stale.claimed).toBe(1);
    expect(stale.fenced).toBe(1);
    expect(stale.published).toBe(0);
    const r = await row(id);
    expect(r.attempts).toBe(2);
    expect(r.publishedAt).toBeTruthy();
    expect(r.leaseToken).toBeNull();
    expect(r.lastError).toBeNull();
    expect(firstLease.leaseToken).toBeTruthy();
    expect(await queue.getJob(eventKey)).toBeTruthy();
  });

  it('does not let a stale enqueue failure overwrite a newer successful publish', async () => {
    const { id } = await insertEvent();
    let releaseSlowAdd!: () => void;
    const gate = new Promise<void>(resolve => { releaseSlowAdd = resolve; });
    const failingQueue = {
      add: async () => {
        await gate;
        throw new Error('redis://user:super-secret@localhost:6379');
      },
    } as unknown as Queue;

    const slow = publishOutboxBatch(pool, failingQueue, { ...opts, batchSize: 1 });
    await waitForLease(id);
    await expireLease(id);
    const newer = await publishOutboxBatch(pool, queue, { ...opts, batchSize: 1 });
    expect(newer.published).toBe(1);
    releaseSlowAdd();
    const stale = await slow;
    expect(stale.fenced).toBe(1);
    expect(stale.failed).toBe(0);
    const r = await row(id);
    expect(r.publishedAt).toBeTruthy();
    expect(r.failedAt).toBeNull();
    expect(r.lastError).toBeNull();
  });

  it('releases a failed enqueue with backoff and dead-letters after max attempts', async () => {
    const { id } = await insertEvent();
    const failingQueue = { add: async () => { throw new Error('redis://user:super-secret@localhost:6379'); } } as unknown as Queue;
    const first = await publishOutboxBatch(pool, failingQueue, { ...opts, maxAttempts: 2, batchSize: 1 });
    expect(first.failed).toBe(1);
    let r = await row(id);
    expect(r.failedAt).toBeNull();
    expect(r.leaseToken).toBeNull();
    expect(r.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(r.lastError).toBe('OUTBOX_ENQUEUE_FAILED');
    expect(JSON.stringify(r)).not.toContain('super-secret');

    await dueNow(id);
    const second = await publishOutboxBatch(pool, failingQueue, { ...opts, maxAttempts: 2, batchSize: 1 });
    expect(second.failed).toBe(1);
    r = await row(id);
    expect(r.attempts).toBe(2);
    expect(r.failedAt).toBeTruthy();
    expect(r.leaseToken).toBeNull();
  });

  it('dead-letters a row whose final attempt crashed and whose lease expired', async () => {
    const { id } = await insertEvent();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await claimOutboxBatch(client, { ...opts, maxAttempts: 1, batchSize: 1 });
      await client.query('COMMIT');
    } finally { client.release(); }
    await expireLease(id);
    const r = await publishOutboxBatch(pool, queue, { ...opts, maxAttempts: 1, batchSize: 1 });
    expect(r.claimed).toBe(0);
    const dead = await row(id);
    expect(dead.failedAt).toBeTruthy();
    expect(dead.lastError).toBe('OUTBOX_ATTEMPTS_EXHAUSTED');
    expect(dead.leaseToken).toBeNull();
  });
});
