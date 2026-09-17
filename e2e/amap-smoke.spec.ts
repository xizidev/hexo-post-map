import { test, expect } from 'playwright/test';
import { runOptionalAmapSmoke } from './optional-amap-smoke';

const key = process.env.HEXO_POST_MAP_AMAP_KEY;
const code = process.env.HEXO_POST_MAP_AMAP_SECURITY_JS_CODE;
test.skip(process.env.AMAP_SMOKE !== '1' || !key || !code, 'Live AMap credentials not supplied');

// Separate opt-in project. No trace, screenshots, response bodies or credential-bearing URLs.
test('optional live AMap initializes one map', async ({ page }) => {
  await page.route('**/posts/single/', async (route) => {
    try {
      const response = await route.fetch({ timeout: 5_000 });
      const body = (await response.text())
        .replaceAll('hpm-build-only-key', key!)
        .replaceAll('hpm-build-only-security', code!);
      await route.fulfill({ response, body });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  await runOptionalAmapSmoke({
    navigate: (timeout) => page.goto('/blog/posts/single/', { timeout }),
    initialize: (timeout) => expect(page.locator('[data-hpm-activate]')).toBeEnabled({ timeout }),
    annotate: (annotation) => test.info().annotations.push(annotation),
    warn: (message) => console.warn(message),
  });
});
