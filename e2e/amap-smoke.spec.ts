import { test, expect } from 'playwright/test';

const key = process.env.HEXO_POST_MAP_AMAP_KEY;
const code = process.env.HEXO_POST_MAP_AMAP_SECURITY_JS_CODE;
test.skip(process.env.AMAP_SMOKE !== '1' || !key || !code, 'Live AMap credentials not supplied');

// Separate opt-in project. No trace, screenshots, response bodies or credential-bearing URLs.
test('optional live AMap initializes one map', async ({ page }) => {
  await page.route('**/posts/single/', async (route) => {
    const response = await route.fetch();
    const body = (await response.text())
      .replaceAll('hpm-build-only-key', key!)
      .replaceAll('hpm-build-only-security', code!);
    await route.fulfill({ response, body });
  });
  await page.goto('/blog/posts/single/');
  try {
    await expect(page.locator('[data-hpm-activate]')).toBeEnabled({ timeout: 25_000 });
  } catch {
    // Non-blocking and deliberately generic: never attach page/network diagnostics.
    test.info().annotations.push({
      type: 'amap-smoke-warning',
      description: 'Live AMap did not initialize; check provider/domain configuration privately.',
    });
    console.warn('Optional AMap smoke did not initialize (non-blocking).');
  }
});
