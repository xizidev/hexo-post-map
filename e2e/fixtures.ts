import { test as base, expect, type Request } from 'playwright/test';
import { fakeSdk } from './fake-sdk';

export const test = base.extend<{
  network: { sdkRequests: number; externalRequests: string[]; local: Record<string, number> };
}>({
  network: [
    async ({ context }, use) => {
      const network = {
        sdkRequests: 0,
        externalRequests: [] as string[],
        local: {} as Record<string, number>,
      };
      // Observe requests independently of routing so page-level delayed routes count too.
      const countLocal = (request: Request) => {
        const url = new URL(request.url());
        if (url.origin === 'http://127.0.0.1:4179')
          network.local[url.pathname] = (network.local[url.pathname] ?? 0) + 1;
      };
      context.on('request', countLocal);
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
      try {
        await use(network);
      } finally {
        context.off('request', countLocal);
      }
    },
    { auto: true },
  ],
});
export { expect };
