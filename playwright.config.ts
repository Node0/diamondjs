import { defineConfig } from '@playwright/test'

/** Acceptance tests (Lifecycle Contract §10.5) against real Chromium. */
export default defineConfig({
  testDir: 'tests/acceptance',
  timeout: 30_000,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173', browserName: 'chromium' },
  webServer: { command: 'node tests/acceptance/app/server.mjs', port: 4173, reuseExistingServer: true },
})
