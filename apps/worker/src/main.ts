import 'dotenv/config';
import { Pool } from 'pg';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { publishOutboxBatch, processWithInbox, type EventEnvelope } from '@getstoopy/events';
import { StructuredLogger } from '@getstoopy/observability';
const envSchema = z.object({
  DATABASE_URL: z.string().startsWith('postgresql://'),
  REDIS_URL: z.string().startsWith('redis://'),
  WORKER_QUEUE: z.string().default('get-stoopy.domain'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  OUTBOX_POLL_MS: z.coerce.number().int().min(50).max(60000).default(500),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(10)
});
const env = envSchema.parse(process.env);
const log = new StructuredLogger();
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 8 });
const queueConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const workerConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue(env.WORKER_QUEUE, { connection: queueConnection });
const handlers = new Map<string, (e: EventEnvelope, tx: any) => Promise<void>>();
export function registerHandler(eventType: string, fn: (e: EventEnvelope, tx: any) => Promise<void>) { handlers.set(eventType, fn); }
registerHandler('test.created', async () => undefined);
registerHandler('security.user.revoked', async () => undefined);
const worker = new Worker(env.WORKER_QUEUE, async job => {
  const handler = handlers.get(job.data.eventType);
  if (!handler) throw new Error('HANDLER_NOT_REGISTERED');
  const result = await processWithInbox(pool, `worker:${env.WORKER_QUEUE}`, job.data, async (event, tx) => handler(event, tx));
  log.info('inbox_event', { eventKey: job.data.eventKey, eventType: job.data.eventType, result });
}, { connection: workerConnection, concurrency: env.WORKER_CONCURRENCY });
worker.on('failed', (job, err) => log.error('worker_job_failed', { jobId: job?.id, error: err.message }));
let stopping = false;
async function poll() {
  while (!stopping) {
    try {
      const r = await publishOutboxBatch(pool, queue, { maxAttempts: env.OUTBOX_MAX_ATTEMPTS, batchSize: env.OUTBOX_BATCH_SIZE, queueName: env.WORKER_QUEUE });
      if (r.claimed > 0) log.info('outbox_batch', r);
    } catch (e) { log.error('outbox_poll_failed', { error: e instanceof Error ? e.message : 'unknown' }); }
    await new Promise(r => setTimeout(r, env.OUTBOX_POLL_MS));
  }
}
async function shutdown() { stopping = true; await worker.close(); await queue.close(); await queueConnection.quit(); await workerConnection.quit(); await pool.end(); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
log.info('worker_started', { queue: env.WORKER_QUEUE });
poll();
