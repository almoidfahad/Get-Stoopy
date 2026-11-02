import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { publishOutboxBatch, type EventEnvelope } from '@getstoopy/events';
import { StructuredLogger } from '@getstoopy/observability';
import { attachInboxDeadLetter, createInboxProcessor, type InboxHandlers } from './inbox-processing.js';
import { runInventoryExpiryTick } from './inventory-expiry.js';
import { runDispatchExpiryTick } from './dispatch-expiry.js';

const envSchema = z.object({
  DATABASE_URL: z.string().startsWith('postgresql://'),
  REDIS_URL: z.string().startsWith('redis://'),
  WORKER_QUEUE: z.string().default('get-stoopy.domain'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  OUTBOX_POLL_MS: z.coerce.number().int().min(50).max(60000).default(500),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(10),
  OUTBOX_LEASE_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  DATABASE_PRIVILEGED_URL: z.string().startsWith('postgresql://').optional(),
  INVENTORY_EXPIRY_ENABLED: z.enum(['true','false']).default('false'),
  INVENTORY_EXPIRY_POLL_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  INVENTORY_EXPIRY_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  DISPATCH_EXPIRY_ENABLED: z.enum(['true','false']).default('false'),
  DISPATCH_EXPIRY_POLL_MS: z.coerce.number().int().min(50).max(60000).default(1000),
  DISPATCH_EXPIRY_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100)
}).refine(env => env.INVENTORY_EXPIRY_ENABLED !== 'true' || !!env.DATABASE_PRIVILEGED_URL, { message: 'DATABASE_PRIVILEGED_URL is required when inventory expiry is enabled' }).refine(env => env.DISPATCH_EXPIRY_ENABLED !== 'true' || !!env.DATABASE_PRIVILEGED_URL, { message: 'DATABASE_PRIVILEGED_URL is required when dispatch expiry is enabled' });
const env = envSchema.parse(process.env);
const log = new StructuredLogger();
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 8 });
const queueConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const workerConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue(env.WORKER_QUEUE, { connection: queueConnection });
const inventoryPool = env.INVENTORY_EXPIRY_ENABLED === 'true' && env.DATABASE_PRIVILEGED_URL ? new Pool({ connectionString: env.DATABASE_PRIVILEGED_URL, max: 2 }) : null;
const dispatchPool = env.DISPATCH_EXPIRY_ENABLED === 'true' && env.DATABASE_PRIVILEGED_URL ? new Pool({ connectionString: env.DATABASE_PRIVILEGED_URL, max: 2 }) : null;
const handlers: InboxHandlers = new Map<string, (e: EventEnvelope, tx: PoolClient) => Promise<void>>();
export function registerHandler(eventType: string, fn: (e: EventEnvelope, tx: PoolClient) => Promise<void>) { handlers.set(eventType, fn); }
registerHandler('test.created', async () => undefined);
registerHandler('security.user.revoked', async () => undefined);
for (const eventType of ['dispatch.run.created','dispatch.offer.created','dispatch.offer.accepted','dispatch.offer.rejected','dispatch.offer.expired','dispatch.run.manual_review','commerce.order.destination_set','commerce.order.recipient_set','delivery.pickup.confirmed','delivery.otp.issued','delivery.otp.verified','delivery.completed']) registerHandler(eventType, async () => undefined);
const consumer = `worker:${env.WORKER_QUEUE}`;
const worker = new Worker(env.WORKER_QUEUE, createInboxProcessor(pool, consumer, handlers, log), { connection: workerConnection, concurrency: env.WORKER_CONCURRENCY });
attachInboxDeadLetter(worker, pool, consumer, log);
let stopping = false;
async function poll() {
  while (!stopping) {
    try {
      const r = await publishOutboxBatch(pool, queue, { maxAttempts: env.OUTBOX_MAX_ATTEMPTS, batchSize: env.OUTBOX_BATCH_SIZE, queueName: env.WORKER_QUEUE, leaseMs: env.OUTBOX_LEASE_MS });
      if (r.claimed > 0) log.info('outbox_batch', { ...r });
    } catch (e) { log.error('outbox_poll_failed', { error: e instanceof Error ? e.message : 'unknown' }); }
    await new Promise(r => setTimeout(r, env.OUTBOX_POLL_MS));
  }
}
async function inventoryExpiryLoop() {
  while (!stopping && inventoryPool) {
    await runInventoryExpiryTick(inventoryPool, log, env.INVENTORY_EXPIRY_BATCH_SIZE);
    await new Promise(r => setTimeout(r, env.INVENTORY_EXPIRY_POLL_MS));
  }
}
async function dispatchExpiryLoop() {
  while (!stopping && dispatchPool) {
    await runDispatchExpiryTick(dispatchPool, log, env.DISPATCH_EXPIRY_BATCH_SIZE);
    await new Promise(r => setTimeout(r, env.DISPATCH_EXPIRY_POLL_MS));
  }
}
async function shutdown() { stopping = true; await worker.close(); await queue.close(); await queueConnection.quit(); await workerConnection.quit(); await pool.end(); if (inventoryPool) await inventoryPool.end(); if (dispatchPool) await dispatchPool.end(); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
log.info('worker_started', { queue: env.WORKER_QUEUE });
poll();
if (inventoryPool) void inventoryExpiryLoop();
if (dispatchPool) void dispatchExpiryLoop();
