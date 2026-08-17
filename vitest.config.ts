import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // Vendored prior-project/reference material — not DiamondJS source; its
    // specs can't even resolve their own deps and must not enter the suite.
    exclude: ['**/node_modules/**', '**/dist/**', 'reference_files/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/tests/**',
        'tools/**',
        'examples/**'
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    }
  }
})
