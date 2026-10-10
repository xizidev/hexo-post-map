import { lstat, readFile } from 'node:fs/promises';
import { test as base, expect } from 'playwright/test';
import { fakeSdk } from './fake-sdk';

const origin = 'http://127.0.0.1:4180';
export const test = base.extend<{
  editorUrl: string;
  sdkUnavailable: boolean;
  network: { sdkRequests: number; denied: string[]; local: string[] };
}>({
  sdkUnavailable: [false, { option: true }],
  network: [
    async ({ context, sdkUnavailable }, use) => {
      const network = { sdkRequests: 0, denied: [] as string[], local: [] as string[] };
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if ([origin, 'http://127.0.0.1:4179'].includes(url.origin)) {
          network.local.push(url.pathname);
          await route.continue();
        } else if (url.origin === 'https://webapi.amap.com' && url.pathname === '/maps') {
          network.sdkRequests++;
          if (sdkUnavailable) await route.abort();
          else await route.fulfill({ contentType: 'text/javascript', body: fakeSdk });
        } else {
          network.denied.push(url.origin);
          await route.abort();
        }
      });
      await use(network);
    },
    { auto: true },
  ],
  editorUrl: async ({ page }, use) => {
    const path = process.env.HPM_AUTHOR_READY_FILE;
    if (!path) throw new Error('Packed author readiness bridge is missing.');
    let url: string | undefined;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const info = await lstat(path);
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.size >= 1024 ||
          (process.platform !== 'win32' && (info.mode & 0o777) !== 0o600)
        )
          throw new Error();
        const handle: unknown = JSON.parse(await readFile(path, 'utf8'));
        if (!handle || typeof handle !== 'object') throw new Error();
        const value = handle as { origin: unknown; url: unknown };
        if (
          Object.keys(handle).sort().join(',') !== 'origin,url' ||
          value.origin !== origin ||
          typeof value.url !== 'string' ||
          !/^http:\/\/127\.0\.0\.1:4180\/#session=[A-Za-z0-9_-]{43}$/u.test(value.url)
        )
          throw new Error();
        url = value.url;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!url) throw new Error('Packed author readiness unavailable.');
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-point-form][data-mounted=true]').waitFor();
      await page.evaluate(() => history.replaceState(null, '', '/'));
    } catch {
      throw new Error('Packed author page could not load.');
    }
    await use(url);
  },
});
// Test-local override takes precedence over CLI retain-on-failure; reader tests keep their setting.
test.use({ trace: 'off' });
export { expect };
