import { UnrecoverableError, type Job, type Worker } from 'bullmq';
import type { Pool, PoolClient } from 'pg';
import {
  parseEventEnvelope,
  processWithInbox,
  recordInboxDeadLetter,
  INBOX_DEAD_LETTER_ERROR_CODES,
  type EventEnvelope,
  type InboxDeadLetterErrorCode,
} from '@getstoopy/events';
import type { StructuredLogger } from '@getstoopy/observability';

export type InboxHandlers = Map<string, (event: EventEnvelope, tx: PoolClient) => Promise<void>>;

export function inboxErrorCode(err: unknown): InboxDeadLetterErrorCode {
  if (err instanceof Error && (INBOX_DEAD_LETTER_ERROR_CODES as readonly string[]).includes(err.message)) {
    return err.message as InboxDeadLetterErrorCode;
  }
  return 'INBOX_HANDLER_FAILED';
}

export function createInboxProcessor(pool: Pool, consumer: string, handlers: InboxHandlers, log: StructuredLogger) {
  return async (job: Job): Promise<void> => {
    let event: EventEnvelope;
    try {
      event = parseEventEnvelope(job.data);
    } catch {
      throw new UnrecoverableError('INBOX_ENVELOPE_INVALID');
    }
    const handler = handlers.get(event.eventType);
    if (!handler) throw new UnrecoverableError('INBOX_HANDLER_NOT_REGISTERED');
    try {
      const result = await processWithInbox(pool, consumer, event, async (e, tx) => handler(e, tx));
      log.info('inbox_event', { eventKey: event.eventKey, eventType: event.eventType, result });
    } catch (err) {
      if (err instanceof UnrecoverableError) throw err;
      // Do not propagate raw handler/driver exception text into BullMQ failedReason or logs.
      throw new Error('INBOX_HANDLER_FAILED');
    }
  };
}

export function attachInboxDeadLetter(worker: Worker, pool: Pool, consumer: string, log: StructuredLogger): void {
  worker.on('failed', (job, err) => {
    const errorCode = inboxErrorCode(err);
    const attemptsMade = job?.attemptsMade ?? 1;
    log.error('worker_job_failed', { jobId: job?.id, errorCode, attemptsMade });
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    const terminal = err.name === 'UnrecoverableError' || attemptsMade >= maxAttempts;
    if (!terminal) return;
    void recordInboxDeadLetter(pool, consumer, job.data, errorCode, Math.max(1, attemptsMade)).catch(() => {
      log.error('inbox_dead_letter_write_failed', { jobId: job.id, errorCode: 'INBOX_DEAD_LETTER_WRITE_FAILED' });
    });
  });
}
