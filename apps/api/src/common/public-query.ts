import { BadRequestException } from '@nestjs/common';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Express can supply arrays or objects, even when TypeScript declares a string. */
export function optionalPublicString(value: unknown, code: string, message: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BadRequestException({ code, message });
  return value;
}

export function optionalPublicUuid(value: unknown, code: string, name: string): string | undefined {
  const string = optionalPublicString(value, code, `Invalid ${name}`);
  if (string === undefined) return undefined;
  if (!UUID_RE.test(string)) throw new BadRequestException({ code, message: `Invalid ${name}` });
  // PostgreSQL accepts uppercase UUIDs but returns lowercase strings; normalise
  // before comparing returned IDs in the service layer.
  return string.toLowerCase();
}

export function optionalPublicSearch(value: unknown, maxLength: number): string | undefined {
  const string = optionalPublicString(value, 'QUERY_INVALID', 'q must be a single string');
  if (string === undefined) return undefined;
  if (string.length > maxLength) throw new BadRequestException({ code: 'QUERY_INVALID', message: 'q is too long' });
  // NUL cannot be stored or compared in PostgreSQL text values.
  if (string.includes('\0')) throw new BadRequestException({ code: 'QUERY_INVALID', message: 'q contains an invalid character' });
  return string.trim() || undefined;
}
