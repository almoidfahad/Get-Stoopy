import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

export const INBOX_DEAD_LETTER_ERROR_CODES = [
  'INBOX_ENVELOPE_INVALID',
  'INBOX_HANDLER_NOT_REGISTERED',
  'INBOX_HANDLER_FAILED',
] as const;
export type InboxDeadLetterErrorCode = (typeof INBOX_DEAD_LETTER_ERROR_CODES)[number];

const MAX_PAYLOAD_BYTES = 16_384;
const MAX_CONSUMER_LENGTH = 128;
const MAX_EVENT_FIELD_LENGTH = 128;

function safeJson(raw: unknown): string {
  try {
    const text = JSON.stringify(raw);
    return text === undefined ? 'null' : text;
  } catch {
    return '{"unserializable":true}';
  }
}

function optionalString(raw: unknown, key: string): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = (raw as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.slice(0, MAX_EVENT_FIELD_LENGTH);
}

/**
 * Persist a terminal inbox failure without storing raw driver/handler exception text.
 * The payload is retained only while small enough for operational review; oversized
 * payloads are represented by a truncation marker plus content hash.
 */
export async function recordInboxDeadLetter(
  pool: Pool,
  consumer: string,
  raw: unknown,
  errorCode: InboxDeadLetterErrorCode,
  attempts: number,
): Promise<void> {
  if (!consumer || consumer.length > MAX_CONSUMER_LENGTH) throw new Error('INBOX_DEAD_LETTER_CONSUMER_INVALID');
  if (!INBOX_DEAD_LETTER_ERROR_CODES.includes(errorCode)) throw new Error('INBOX_DEAD_LETTER_ERROR_CODE_INVALID');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10_000) throw new Error('INBOX_DEAD_LETTER_ATTEMPTS_INVALID');

  const payloadText = safeJson(raw);
  const payloadHash = createHash('sha256').update(payloadText).digest('hex');
  const payload = Buffer.byteLength(payloadText, 'utf8') <= MAX_PAYLOAD_BYTES
    ? JSON.parse(payloadText) as unknown
    : { truncated: true, payloadHash };
  const eventKey = optionalString(raw, 'eventKey');
  const eventType = optionalString(raw, 'eventType');

  await pool.query(
    `INSERT INTO "InboxDeadLetter"
       (consumer, "eventKey", "eventType", "payloadHash", payload, "errorCode", attempts, "firstFailedAt", "lastFailedAt")
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,now(),now())
     ON CONFLICT (consumer, "payloadHash") DO UPDATE SET
       attempts = GREATEST("InboxDeadLetter".attempts, EXCLUDED.attempts),
       "errorCode" = EXCLUDED."errorCode",
       "eventKey" = COALESCE(EXCLUDED."eventKey", "InboxDeadLetter"."eventKey"),
       "eventType" = COALESCE(EXCLUDED."eventType", "InboxDeadLetter"."eventType"),
       "lastFailedAt" = now()`,
    [consumer, eventKey, eventType, payloadHash, JSON.stringify(payload), errorCode, attempts],
  );
}
