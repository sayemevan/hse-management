import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/** Sprint 9: the first web unit tests (offline layer logic, with fake-indexeddb). */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
  },
});
