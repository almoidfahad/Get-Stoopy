import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasProjectPrismaTypes } from '../../../scripts/check-prisma-client.mjs';

const dirs: string[] = [];
function fixture(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'stoopy-prisma-check-'));
  dirs.push(dir);
  const file = path.join(dir, 'index.d.ts');
  writeFileSync(file, content);
  return file;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('Prisma setup preflight', () => {
  it('accepts a declaration containing both project model and transaction types', () => {
    expect(hasProjectPrismaTypes(fixture('export type TransactionClient = unknown;\nexport type StoreWhereInput = {};'))).toBe(true);
  });
  it('rejects the default placeholder or an incomplete declaration', () => {
    expect(hasProjectPrismaTypes(fixture('export declare class PrismaClient {}'))).toBe(false);
    expect(hasProjectPrismaTypes(fixture('export type TransactionClient = unknown;'))).toBe(false);
  });
  it('rejects a missing file', () => {
    expect(hasProjectPrismaTypes('/this-file-does-not-exist/index.d.ts')).toBe(false);
  });
});
