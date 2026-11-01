import type { Pool } from 'pg';
import { parseEventEnvelope, type EventEnvelope } from './envelope.js';
export type InboxHandler = (event: EventEnvelope, tx: import('pg').PoolClient) => Promise<void>;
export async function processWithInbox(pool: Pool, consumer: string, raw: unknown, handler: InboxHandler): Promise<'processed' | 'duplicate'> {
  const event = parseEventEnvelope(raw);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const receipt = await client.query('INSERT INTO "InboxReceipt"(consumer, "eventKey") VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING consumer', [consumer, event.eventKey]);
    if (receipt.rowCount === 0) { await client.query('ROLLBACK'); return 'duplicate'; }
    await handler(event, client);
    await client.query('COMMIT');
    return 'processed';
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
