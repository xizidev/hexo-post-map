import { test as base, expect } from 'playwright/test';
import { fakeSdk } from './fake-sdk';

export const test = base.extend<{ network: { sdkRequests: number; externalRequests: string[] } }>({
  network: [
    async ({ context }, use) => {
      const network = { sdkRequests: 0, externalRequests: [] as string[] };
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === 'http://127.0.0.1:4179') {
          await route.continue();
          return;
        }
        // Default-deny every external origin, including any new AMap/CDN origin.
        network.externalRequests.push(url.origin);
        if (url.hostname === 'webapi.amap.com' && url.pathname === '/maps') {
          network.sdkRequests++;
          await route.fulfill({ contentType: 'text/javascript', body: fakeSdk });
        } else await route.abort();
      });
      await use(network);
    },
    { auto: true },
  ],
});
export { expect };
