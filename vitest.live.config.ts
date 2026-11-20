import { defineConfig } from 'vitest/config';

// Live evaluation against the real Claude API. Skipped unless credentials are available.
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    testTimeout: 600_000,
  },
});
