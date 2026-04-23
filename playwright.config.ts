import { defineConfig } from '@playwright/test';

const port = 3101;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 15_000
  },
  use: {
    baseURL,
    trace: 'on-first-retry'
  },
  reporter: [['list']],
  outputDir: 'artifacts/playwright/test-results',
  webServer: {
    command: `PORT=${port} node --import tsx scripts/e2e-server.ts`,
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000
  }
});
