import type { Locator, Page } from 'playwright/test';
import { test, expect } from './fixtures';

async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let press = 0; press < 30; press++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('overview article links and detail places remain readable and keyboard reachable', async ({
    page,
    network,
  }) => {
    await page.goto('/blog/map/');
    const fallback = page.locator('[data-hpm-fallback]');
    await expect(fallback).toBeVisible();
    await expect(fallback.locator('li')).toHaveCount(4);
    await expect(fallback.locator('[data-attack]')).toHaveCount(0);
    const article = fallback.getByRole('link', { name: 'Mountain itinerary', exact: true });
    await tabTo(page, article);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/blog\/posts\/route\/$/);
    await expect(
      page.getByText('The route differs from point declaration order to detect incorrect sorting.'),
    ).toBeVisible();
    const places = page.locator('[data-hpm-fallback]');
    await expect(places).toBeVisible();
    await expect(places.locator('a')).toHaveText([
      'Summit GCJ-02',
      'Visitor center GCJ-02',
      'Cableway GCJ-02',
    ]);
    await tabTo(page, places.getByRole('link', { name: 'Visitor center GCJ-02' }));
    expect(network.sdkRequests).toBe(0);
  });
});

for (const mobile of [false, true]) {
  test(`reduced motion and keyboard-only map navigation on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/blog/map/');
    const activate = page.locator('[data-hpm-activate]');
    await expect(activate).toBeEnabled();
    await tabTo(page, activate);
    await page.keyboard.press('Enter');
    await tabTo(page, page.getByRole('button', { name: '查看此处的 4 篇文章' }));
    await page.keyboard.press('Enter');
    const overlap = page.getByRole('button', { name: '查看此处的 2 篇文章' });
    await tabTo(page, overlap);
    await page.keyboard.press('Enter');
    const group = page.getByRole('dialog', { name: '此处的文章' });
    await expect(group.locator('li')).toHaveCount(2);
    await expect(group.getByRole('button', { name: '关闭文章面板' })).toBeFocused();
    await expect(group).toHaveCSS('transition-duration', '0s');
    await expect(group).toHaveCSS('animation-name', 'none');
    expect(
      await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].options.animateEnable),
    ).toBe(false);
    await page.keyboard.press('Escape');
    await expect(overlap).toBeFocused();
    await tabTo(page, page.getByRole('button', { name: '预览文章：Mountain itinerary' }));
    await page.keyboard.press('Enter');
    const preview = page.getByRole('dialog', { name: '文章预览' });
    await tabTo(page, preview.locator('a').filter({ has: page.locator('img') }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/blog\/posts\/route\/$/);
    await expect(page.locator('[data-hpm-activate]')).toBeEnabled();
    await tabTo(page, page.locator('[data-hpm-activate]'));
    await page.keyboard.press('Enter');
    const marker = page.getByRole('button', { name: 'Visitor center GCJ-02' });
    await tabTo(page, marker);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: '在高德地图中查看' })).toBeVisible();
    expect(
      await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].options.animateEnable),
    ).toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-hpm-activate]')).toBeFocused();
    await expect(
      page.getByText('The route differs from point declaration order to detect incorrect sorting.'),
    ).toBeVisible();
  });
}
