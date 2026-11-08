import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'apps/web/src') } },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/web/test/**/*.test.tsx'],
    environment: 'node',
    coverage: { enabled: false }
  }
});
