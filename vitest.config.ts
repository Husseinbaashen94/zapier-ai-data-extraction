import { defineConfig } from 'vitest/config';

// Fast suite: contract and unit tests. No network, no API key.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/contract/**/*.test.ts'],
  },
});
