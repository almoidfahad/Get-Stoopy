import { describe, it, expect } from 'vitest';
import { parseEventEnvelope } from '../src/envelope';
import { retryDelayMs } from '../src/outbox';
const valid = { schemaVersion: 1, eventKey: 'event-12345678', eventType: 'test.created', occurredAt: '2026-11-01T00:00:00.000Z', aggregateType: 'Test', aggregateId: '00000000-0000-4000-8000-000000000001', data: { ok: true } };
describe('event envelope', () => {
  it('parses a valid envelope and defaults scopeRefs', () => { expect(parseEventEnvelope(valid).scopeRefs).toEqual([]); });
  it('rejects unsupported schema versions', () => { expect(() => parseEventEnvelope({ ...valid, schemaVersion: 2 })).toThrow(); });
  it('rejects missing aggregate identity', () => { const { aggregateId, ...bad } = valid; expect(() => parseEventEnvelope(bad)).toThrow(); });
});
describe('outbox retry', () => {
  it('uses bounded exponential backoff', () => { expect(retryDelayMs(1)).toBe(1000); expect(retryDelayMs(3)).toBe(4000); expect(retryDelayMs(99)).toBe(60000); });
});
