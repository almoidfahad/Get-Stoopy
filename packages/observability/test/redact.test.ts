import { describe, expect, it } from 'vitest';
import { logRecord, redact, StructuredLogger } from '../src/index.js';
describe('redaction', () => {
  it('redacts sensitive keys recursively', () => expect(redact({ a: { password: 'x', token: 'y', ok: 1 } })).toEqual({ a: { password: '[REDACTED]', token: '[REDACTED]', ok: 1 } }));
  it('redacts OTP and bank fields', () => expect(redact({ otp: '123456', bankAccount: '123', recipientPhone: 'x' })).toEqual({ otp: '[REDACTED]', bankAccount: '[REDACTED]', recipientPhone: '[REDACTED]' }));
  it('truncates long strings', () => expect(String(redact('x'.repeat(3000))).length).toBeLessThan(2100));
  it('emits structured JSON without secrets', () => { const lines: string[] = []; const l = new StructuredLogger(s => lines.push(s)); l.info('test', { requestId: 'r1', password: 'secret' }); expect(lines[0]).toContain('"requestId":"r1"'); expect(lines[0]).not.toContain('secret'); });
  it('respects level', () => { const lines: string[] = []; const l = new StructuredLogger(s => lines.push(s), 'warn'); l.info('x'); l.warn('y'); expect(lines).toHaveLength(1); });
});
