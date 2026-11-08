import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Detect the default placeholder shipped by @prisma/client before generation. */
export function hasProjectPrismaTypes(file) {
  try {
    const text = readFileSync(file, 'utf8');
    return /export type TransactionClient\s*=/.test(text) && /export type StoreWhereInput\s*=/.test(text);
  } catch {
    return false;
  }
}

export function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const declaration = path.join(root, 'node_modules', '.prisma', 'client', 'index.d.ts');
  if (hasProjectPrismaTypes(declaration)) return 0;
  console.error([
    'Project Prisma Client types are missing. TypeScript may report many cascading errors.',
    'From the repository root, install dependencies and run: npm run setup:dev',
    'This generates the client from packages/db/prisma/schema.prisma and builds workspace packages.',
    'Generation may require access to Prisma engine downloads; see README.md for setup notes.',
  ].join('\n'));
  return 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main();
}
