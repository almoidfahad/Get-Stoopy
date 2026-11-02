import { describe, it, expect } from 'vitest';
import { parseEventEnvelope } from '../src/envelope';
import { publishOutboxBatch, retryDelayMs } from '../src/outbox';
import type { Pool } from 'pg';
import type { Queue } from 'bullmq';
const valid = { schemaVersion: 1, eventKey: 'event-12345678', eventType: 'test.created', occurredAt: '2026-11-01T00:00:00.000Z', aggregateType: 'Test', aggregateId: '00000000-0000-4000-8000-000000000001', data: { ok: true } };
describe('event envelope', () => {
  it('parses a valid envelope and defaults scopeRefs', () => { expect(parseEventEnvelope(valid).scopeRefs).toEqual([]); });
  it('rejects unsupported schema versions', () => { expect(() => parseEventEnvelope({ ...valid, schemaVersion: 2 })).toThrow(); });
  it('rejects missing aggregate identity', () => { const { aggregateId, ...bad } = valid; expect(() => parseEventEnvelope(bad)).toThrow(); });
});
describe('outbox retry', () => {
  it('uses bounded exponential backoff', () => { expect(retryDelayMs(1)).toBe(1000); expect(retryDelayMs(3)).toBe(4000); expect(retryDelayMs(99)).toBe(60000); });
});
describe('outbox option validation', () => {
  const pool = {} as Pool; const queue = {} as Queue;
  const base = { maxAttempts: 5, batchSize: 10, queueName: 'test-queue' };
  it('rejects invalid batch size before touching the pool', async () => {
    await expect(publishOutboxBatch(pool, queue, { ...base, batchSize: 0 })).rejects.toThrow('OUTBOX_BATCH_SIZE_OUT_OF_RANGE');
    await expect(publishOutboxBatch(pool, queue, { ...base, batchSize: 101 })).rejects.toThrow('OUTBOX_BATCH_SIZE_OUT_OF_RANGE');
  });
  it('rejects invalid max attempts', async () => {
    await expect(publishOutboxBatch(pool, queue, { ...base, maxAttempts: 0 })).rejects.toThrow('OUTBOX_MAX_ATTEMPTS_OUT_OF_RANGE');
  });
  it('rejects invalid visibility lease', async () => {
    await expect(publishOutboxBatch(pool, queue, { ...base, leaseMs: 999 })).rejects.toThrow('OUTBOX_LEASE_MS_OUT_OF_RANGE');
    await expect(publishOutboxBatch(pool, queue, { ...base, leaseMs: 300001 })).rejects.toThrow('OUTBOX_LEASE_MS_OUT_OF_RANGE');
  });
  it('rejects BullMQ-unsafe queue names', async () => {
    await expect(publishOutboxBatch(pool, queue, { ...base, queueName: 'bad:queue' })).rejects.toThrow('OUTBOX_QUEUE_NAME_INVALID');
  });
});
