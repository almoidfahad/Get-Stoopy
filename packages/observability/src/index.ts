export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const SENSITIVE = /password|secret|token|authorization|cookie|otp|totp|nid|passport|bank|accountnumber|recipientphone|location|latitude|longitude/i;
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[MAX_DEPTH]';
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return value.slice(0, 2000) + '[TRUNCATED]';
  return value;
}
export interface LogRecord { ts: string; level: LogLevel; message: string; requestId?: string; [k: string]: unknown; }
export function logRecord(level: LogLevel, message: string, fields: Record<string, unknown> = {}): LogRecord {
  return { ts: new Date().toISOString(), level, message, ...redact(fields) as Record<string, unknown> };
}
export class StructuredLogger {
  constructor(private readonly sink: (line: string) => void = console.log, private readonly min: LogLevel = 'info') {}
  private rank(l: LogLevel) { return { debug: 10, info: 20, warn: 30, error: 40 }[l]; }
  log(level: LogLevel, message: string, fields: Record<string, unknown> = {}) { if (this.rank(level) >= this.rank(this.min)) this.sink(JSON.stringify(logRecord(level, message, fields))); }
  info(message: string, fields?: Record<string, unknown>) { this.log('info', message, fields); }
  warn(message: string, fields?: Record<string, unknown>) { this.log('warn', message, fields); }
  error(message: string, fields?: Record<string, unknown>) { this.log('error', message, fields); }
}
