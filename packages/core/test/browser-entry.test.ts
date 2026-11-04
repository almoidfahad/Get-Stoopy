import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The browser entry must stay free of Node builtins.
 *
 * A client component that imports the main barrel pulls `node:crypto` (via the
 * payment module) into the browser bundle and the Next.js build fails. That
 * failure is easy to reintroduce by adding one innocent-looking re-export, so
 * this walks the entry's transitive relative imports and asserts the boundary.
 */
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function collect(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
    const target = resolve(dirname(file), (match[1] as string).replace(/\.js$/, '.ts'));
    collect(target, seen);
  }
  return seen;
}

describe('browser-safe core entry', () => {
  const files = [...collect(resolve(srcDir, 'browser.ts'))];

  it('reaches at least the modules the checkout UI needs', () => {
    const names = files.map(file => file.split('/').pop());
    expect(names).toContain('checkout-quote.ts');
    expect(names).toContain('cart-summary.ts');
    expect(names).toContain('catalog-display.ts');
  });

  it('never imports a Node builtin, directly or transitively', () => {
    const offenders = files.filter(file => /from\s+'node:/.test(readFileSync(file, 'utf8')));
    expect(offenders.map(file => file.split('/').pop())).toEqual([]);
  });

  it('does not pull in the server-only modules', () => {
    const names = files.map(file => file.split('/').pop());
    for (const forbidden of ['payment.ts', 'dispatch.ts', 'kyc-retention.ts', 'payout-destination.ts', 'delivery-proof.ts', 'index.ts']) {
      expect(names).not.toContain(forbidden);
    }
  });
});
