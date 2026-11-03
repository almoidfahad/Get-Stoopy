import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const config = JSON.parse(read('vercel.json')) as Record<string, unknown>;
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
const script = fileURLToPath(new URL('scripts/vercel-preview-only.mjs', root));

function runGuard(environment?: string) {
  const env = { ...process.env };
  delete env.VERCEL_ENV;
  if (environment !== undefined) env.VERCEL_ENV = environment;
  return spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
}

describe('Vercel preview-only deployment guard', () => {
  it('disables automatic Git deployments and production alias promotion', () => {
    expect(config.git).toEqual({ deploymentEnabled: false });
    expect(config.github).toEqual({ autoAlias: false });
    expect(config.ignoreCommand).toBe('node scripts/vercel-preview-only.mjs');
  });

  it('allows only preview builds and fails closed for production or unknown environments', () => {
    const preview = runGuard('preview');
    expect(preview.status).toBe(1);
    expect(preview.stdout).toContain('Preview deployment allowed');

    for (const environment of ['production', 'development', '', undefined]) {
      const result = runGuard(environment);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('only preview deployments are authorized');
    }
  });

  it('keeps the web-only Vercel build separate from the full monorepo build', () => {
    expect(config.framework).toBe('nextjs');
    expect(config.buildCommand).toBe('npm run build:vercel');
    expect(config.outputDirectory).toBe('apps/web/.next');
    expect(config.installCommand).toBe('npm install --global npm@10.8.2 && npm ci --no-audit --no-fund');
    expect(pkg.scripts['build:vercel']).toBe('npm run build:packages && npm run build:web');
    expect(pkg.scripts.build).toBe('npm run build:packages && npm run build:api && npm run build:worker && npm run build:web');
  });

  it('keeps the full-build CI gate and contains no production deployment command', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('- run: npm run build');
    expect(ci).not.toMatch(/vercel\s+deploy/);
    expect(ci).not.toContain('--prod');
  });
});
