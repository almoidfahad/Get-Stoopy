import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { recordInboxDeadLetter } from '../src/dead-letter';

function fakePool() {
  const calls: { sql: string; values: unknown[] }[] = [];
  const pool = { query: async (sql: string, values: unknown[]) => { calls.push({ sql, values }); return { rowCount: 1 }; } } as unknown as Pool;
  return { pool, calls };
}

describe('inbox dead-letter recorder', () => {
  it('stores a stable error code and payload hash, not raw exception text', async () => {
    const { pool, calls } = fakePool();
    await recordInboxDeadLetter(pool, 'worker:test', { eventKey: 'evt-12345678', eventType: 'test.created', data: { ok: true } }, 'INBOX_HANDLER_FAILED', 3);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain('ON CONFLICT (consumer, "payloadHash") DO UPDATE');
    expect(calls[0]!.values).toContain('INBOX_HANDLER_FAILED');
    expect(JSON.stringify(calls[0]!.values)).not.toContain('super-secret');
  });
  it('rejects invalid consumer/error-code/attempts before querying', async () => {
    const { pool, calls } = fakePool();
    await expect(recordInboxDeadLetter(pool, '', {}, 'INBOX_HANDLER_FAILED', 1)).rejects.toThrow('INBOX_DEAD_LETTER_CONSUMER_INVALID');
    await expect(recordInboxDeadLetter(pool, 'worker:test', {}, 'RAW_SECRET' as never, 1)).rejects.toThrow('INBOX_DEAD_LETTER_ERROR_CODE_INVALID');
    await expect(recordInboxDeadLetter(pool, 'worker:test', {}, 'INBOX_HANDLER_FAILED', 0)).rejects.toThrow('INBOX_DEAD_LETTER_ATTEMPTS_INVALID');
    expect(calls).toHaveLength(0);
  });
  it('truncates oversized payloads while preserving a hash marker', async () => {
    const { pool, calls } = fakePool();
    await recordInboxDeadLetter(pool, 'worker:test', { eventKey: 'evt-12345678', data: { blob: 'x'.repeat(20000) } }, 'INBOX_ENVELOPE_INVALID', 1);
    const payload = JSON.parse(String(calls[0]!.values[4])) as { truncated?: boolean; payloadHash?: string };
    expect(payload.truncated).toBe(true);
    expect(payload.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
