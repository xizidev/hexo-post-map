import { defineConfig, devices } from 'playwright/test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.HPM_AUTHOR_RUN_ID ??= randomUUID();
if (!/^[a-f0-9-]{36}$/u.test(process.env.HPM_AUTHOR_RUN_ID))
  throw new Error('Invalid browser run ID');
process.env.HPM_AUTHOR_READY_FILE = join(
  tmpdir(),
  `hpm-author-browser-${process.env.HPM_AUTHOR_RUN_ID}.json`,
);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4179',
    channel: 'chromium',
    serviceWorkers: 'block',
    trace: 'off',
  },
  webServer: {
    command: 'node test/integration/pack-and-build.mjs --serve',
    url: 'http://127.0.0.1:4179/blog/map/',
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/amap-smoke.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'amap-smoke',
      testMatch: '**/amap-smoke.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
