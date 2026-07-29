import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    exclude: ['**/*.integration.test.ts', '**/node_modules/**', '**/dist/**'],
    passWithNoTests: true,
  },
});
