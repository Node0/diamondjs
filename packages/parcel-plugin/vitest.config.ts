import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Only include utils.ts in coverage
      // The transformer entry point (index.ts) is just glue code
      // that calls the tested utils - full integration testing is done via examples
      include: ['src/utils.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})
