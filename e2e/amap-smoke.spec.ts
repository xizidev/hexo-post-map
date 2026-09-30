import { test, expect } from 'playwright/test';
import { TRACK_ASSET_BODY, TRACK_ASSET_PATH, withTrackedDetailHtml } from './fixtures';
import { runOptionalAmapSmoke } from './optional-amap-smoke';

const key = process.env.HEXO_POST_MAP_AMAP_KEY;
const code = process.env.HEXO_POST_MAP_AMAP_SECURITY_JS_CODE;
test.skip(process.env.AMAP_SMOKE !== '1' || !key || !code, 'Live AMap credentials not supplied');

// Separate opt-in project. No trace, screenshots, response bodies or credential-bearing URLs.
test('optional live AMap initializes one converted recorded track', async ({ page }) => {
  await page.route(`**${TRACK_ASSET_PATH}`, (route) =>
    route.fulfill({ contentType: 'application/json', body: TRACK_ASSET_BODY }),
  );
  await page.route('**/posts/single/', async (route) => {
    try {
      const response = await route.fetch({ timeout: 5_000 });
      const body = withTrackedDetailHtml(
        (await response.text())
          .replaceAll('hpm-build-only-key', key!)
          .replaceAll('hpm-build-only-security', code!),
      );
      await route.fulfill({ response, body });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  await runOptionalAmapSmoke({
    navigate: (timeout) => page.goto('/blog/posts/single/', { timeout }),
    initialize: async (timeout) => {
      await expect(page.locator('[data-hpm-detail]')).toHaveAttribute('data-hpm-active', 'true', {
        timeout,
      });
      await expect(page.locator('[data-hpm-playback]')).toBeVisible({ timeout });
      await expect(page.locator('[data-hpm-status]')).toBeEmpty({ timeout });
    },
    annotate: (annotation) => test.info().annotations.push(annotation),
    warn: (message) => console.warn(message),
  });
});
