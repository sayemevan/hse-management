import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests start the local Workers runtime (D1, KV) once per file.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    environment: 'node',
  },
});
