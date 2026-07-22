import { defineConfig } from '@playwright/test';

/**
 * Invoice Trust Ledger — E2E evidence & regression config
 *
 * PRE-REQS (this suite does NOT start them for you):
 *   1. Fabric network up + chaincode deployed
 *   2. API:    cd api    && node server.js     (http://localhost:3000, LEDGER_MODE=fabric or mock)
 *   3. Portal: cd portal && npm run dev        (http://localhost:5173)
 *
 * global-setup.ts verifies all of the above and fails fast with a clear message.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',

  // The full lifecycle test crosses ~6 blockchain writes (~2-3s each) + one Gemini call.
  timeout: 300_000,
  expect: { timeout: 25_000 },

  fullyParallel: false,
  workers: 1,
  retries: 0, // evidence runs must not silently retry

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    trace: 'on',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
  },

  projects: [
    {
      name: 'ui-evidence',
      testMatch: /invoice-lifecycle\.spec\.ts/,
      use: {
        baseURL: 'http://localhost:5173',
        viewport: { width: 1280, height: 800 },
        video: { mode: 'on', size: { width: 1280, height: 800 } },
      },
    },
    {
      name: 'api-regression',
      testMatch: /api-regression\.spec\.ts/,
      use: {
        baseURL: 'http://localhost:3000',
      },
    },
  ],
});
