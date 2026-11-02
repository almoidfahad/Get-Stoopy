import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    // Integration tests share one PostgreSQL/Redis fixture; run files serially
    // so outbox/RLS tests cannot claim or mutate each other's pending rows.
    fileParallelism: false,
    coverage: { enabled: false }
  }
});
