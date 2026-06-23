import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/llm/**/*.eval.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    maxConcurrency: 2,
  },
});
