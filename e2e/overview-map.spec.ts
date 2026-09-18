import { test, expect } from './fixtures';

for (const mobile of [false, true]) {
  test(`cluster zoom, identical terminal list, close/focus and image navigation on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
    network,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await page.goto('/blog/map/');
    const root = page.locator('[data-hpm-overview]');
    await expect(root.locator('[data-hpm-activate]')).toHaveCount(0);
    await expect(root).toHaveAttribute('data-hpm-active', 'true');
    expect(network.sdkRequests).toBe(1);
    const initialCluster = page.getByRole('button', { name: '查看此处的 4 篇文章' });
    const clusterSurface = initialCluster.locator('.hpm-cluster__surface--small');
    await expect(clusterSurface).toHaveCount(1);
    expect(
      await clusterSurface.evaluate((surface) => {
        const bounds = surface.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      }),
    ).toEqual({ width: 34, height: 34 });
    expect(
      await page.evaluate(() => {
        const sdk = Reflect.get(window, '__hpmSdk');
        return sdk.maps[0].cluster.markers.find(
          (item: { content: HTMLElement }) =>
            item.content.getAttribute('aria-label') === '查看此处的 4 篇文章',
        ).offset;
      }),
    ).toEqual({ x: -22, y: -22 });
    await initialCluster.click();
    const leaf = page.getByRole('button', { name: '预览文章：Mountain itinerary' });
    await expect(leaf).toBeVisible();
    await expect(leaf.locator('.hpm-image-marker__card')).toHaveCount(1);
    await expect(leaf.locator('.hpm-image-marker__stem')).toHaveCount(1);
    await expect(leaf.locator('.hpm-image-marker__dot')).toHaveCount(1);
    await expect(leaf.locator('.hpm-image-marker__card')).toHaveCSS(
      'width',
      mobile ? '64px' : '72px',
    );
    await expect(leaf.locator('.hpm-image-marker__card')).toHaveCSS(
      'height',
      mobile ? '48px' : '54px',
    );
    expect(
      await leaf.evaluate((button) => {
        const image = button.querySelector('img')!.getBoundingClientRect();
        const anchor = button.querySelector('.hpm-image-marker__dot')!.getBoundingClientRect();
        return image.bottom <= anchor.top;
      }),
    ).toBe(true);
    expect(
      await page.evaluate(() => {
        const sdk = Reflect.get(window, '__hpmSdk');
        const marker = sdk.maps[0].cluster.markers.find(
          (item: { content: HTMLElement }) =>
            item.content.getAttribute('aria-label') === '预览文章：Mountain itinerary',
        );
        return marker.offset;
      }),
    ).toEqual(mobile ? { x: -32, y: -66 } : { x: -36, y: -72 });
    expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].zoom)).toBe(5);
    const overlap = page.getByRole('button', { name: '查看此处的 2 篇文章' });
    await overlap.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: '2 篇文章' });
    await expect(panel).toHaveAttribute('data-hpm-viewport', mobile ? 'mobile' : 'desktop');
    await expect(panel.locator('li')).toHaveCount(2);
    await expect(panel.locator('time')).toHaveText(['2025-05-01', '2025-02-01']);
    await expect(panel).toHaveCSS('position', mobile ? 'fixed' : 'absolute');
    if (mobile) {
      const box = await panel.boundingBox();
      expect(Math.round(box!.y + box!.height)).toBe(844);
    }
    expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].zoom)).toBe(5);
    await expect(panel.locator('[data-attack]')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '关闭文章面板' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(overlap).toBeFocused();
    const marker = page.getByRole('button', { name: '预览文章：Mountain itinerary' });
    await marker.click();
    const preview = page.getByRole('dialog', { name: '1 篇文章' });
    await expect(preview.locator('img')).toHaveAttribute(
      'src',
      '/blog/hexo-post-map/assets/placeholder.svg',
    );
    await preview
      .locator('a')
      .filter({ has: page.locator('img') })
      .click();
    await expect(page).toHaveURL(/\/blog\/posts\/route\/$/);
    await expect(page.locator('[data-hpm-detail]')).toBeVisible();
  });

  test(`all-posts panel scrolls within its bounds without growing the page on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await page.route('**/map/posts.json', (route) =>
      route.fulfill({
        json: {
          version: 1,
          posts: Array.from({ length: 30 }, (_, index) => ({
            title: `Article ${index + 1}`,
            url: '/blog/posts/route/',
            image: '/blog/hexo-post-map/assets/placeholder.svg',
            date: `2025-06-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
            location: { name: 'Shanghai', longitude: 121, latitude: 31 },
          })),
        },
      }),
    );
    await page.goto('/blog/map/');
    const toggle = page.getByRole('button', { name: '全部文章 30', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const initialMap = (await page.locator('[data-hpm-canvas]').boundingBox())!;
    const initialToggle = (await toggle.boundingBox())!;
    expect(Math.abs(initialToggle.y - initialMap.y - 16)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(initialMap.x + initialMap.width - initialToggle.x - initialToggle.width - 16),
    ).toBeLessThanOrEqual(1);
    expect(initialToggle.x).toBeGreaterThanOrEqual(initialMap.x);
    expect(initialToggle.y + initialToggle.height).toBeLessThanOrEqual(
      initialMap.y + initialMap.height,
    );
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    await toggle.click();
    const panel = page.getByRole('dialog', { name: '30 篇文章', exact: true });
    await expect(panel.locator('.hpm-post__link')).toHaveCount(30);
    await expect(panel.locator('.hpm-post__title').first()).toHaveText('Article 30');
    await expect(toggle).toHaveAttribute('aria-controls', (await panel.getAttribute('id'))!);
    await expect(page.locator('[data-hpm-fallback]')).toBeHidden();
    const bounds = await panel.boundingBox();
    const mapBounds = await page.locator('[data-hpm-canvas]').boundingBox();
    const titleBounds = await page.locator('[data-hpm-overview] > h1').boundingBox();
    expect(titleBounds!.y + titleBounds!.height).toBeLessThanOrEqual(mapBounds!.y);
    expect(bounds!.height).toBeLessThanOrEqual(
      mobile ? 844 * 0.65 + 1 : mapBounds!.height * 0.7 + 1,
    );
    if (!mobile) {
      expect(bounds!.y).toBe(mapBounds!.y + 72);
      expect(bounds!.x).toBeGreaterThanOrEqual(mapBounds!.x);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(mapBounds!.x + mapBounds!.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(mapBounds!.y + mapBounds!.height);
    }
    const toggleBounds = await toggle.boundingBox();
    expect(Math.abs(toggleBounds!.y - mapBounds!.y - 16)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(mapBounds!.x + mapBounds!.width - toggleBounds!.x - toggleBounds!.width - 16),
    ).toBeLessThanOrEqual(1);
    expect(toggleBounds!.y).toBeGreaterThanOrEqual(mapBounds!.y);
    expect(toggleBounds!.y + toggleBounds!.height).toBeLessThanOrEqual(
      mapBounds!.y + mapBounds!.height,
    );
    if (!mobile) expect(toggleBounds!.y + toggleBounds!.height).toBeLessThanOrEqual(bounds!.y);
    const scroller = panel.locator('.hpm-panel__scroller');
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const headerY = (await panel.locator('.hpm-panel__header').boundingBox())!.y;
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect((await panel.locator('.hpm-panel__header').boundingBox())!.y).toBe(headerY);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(pageHeight);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).not.toHaveAttribute('aria-controls');
    await toggle.click();
    await expect(panel).toBeVisible();
    await toggle.click();
    await expect(panel).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).not.toHaveAttribute('aria-controls');
    await toggle.click();
    await panel.locator('.hpm-post__location').first().click();
    await expect(page).toHaveURL(/\/blog\/posts\/route\/$/);
  });
}

for (const failure of ['http', 'network']) {
  test(`overview data ${failure} failure preserves chronological fallback links`, async ({
    page,
  }) => {
    await page.route('**/map/posts.json', (route) =>
      failure === 'network' ? route.abort() : route.fulfill({ status: 503, body: '{}' }),
    );
    await page.goto('/blog/map/');
    await expect(page.locator('[data-hpm-status]')).toContainText('无法加载');
    const fallback = page.locator('[data-hpm-fallback]');
    await expect(fallback).toBeVisible();
    await expect(page.locator('[data-hpm-overview]')).toHaveCSS('display', 'block');
    const mapBounds = await page.locator('[data-hpm-canvas]').boundingBox();
    expect((await fallback.boundingBox())!.y).toBeGreaterThanOrEqual(
      mapBounds!.y + mapBounds!.height,
    );
    await expect(fallback.locator('time')).toHaveText([
      '2025-05-01',
      '2025-04-01',
      '2025-03-01',
      '2025-02-01',
    ]);
    await fallback.getByRole('link', { name: 'Mountain itinerary', exact: true }).click();
    await expect(page).toHaveURL(/\/blog\/posts\/route\/$/);
  });
}

test('failed representative images use the packaged placeholder and the list remains accessible', async ({
  page,
}) => {
  await page.goto('/blog/map/');
  await page.getByRole('button', { name: '查看此处的 4 篇文章' }).click();
  await page.getByRole('button', { name: '预览文章：Quzhou multiple places' }).click();
  const preview = page.getByRole('dialog', { name: '1 篇文章' });
  await expect(preview.locator('img')).toHaveAttribute(
    'src',
    '/blog/hexo-post-map/assets/placeholder.svg',
  );
  await preview.getByRole('button', { name: '关闭文章面板' }).click();
  await page.getByRole('button', { name: '全部文章 4' }).click();
  await expect(page.getByRole('dialog', { name: '4 篇文章' }).locator('li')).toHaveCount(4);
  await expect(page.locator('[data-hpm-fallback]')).toBeHidden();
});

test('a surviving cluster at maximum zoom opens its list without another zoom', async ({
  page,
}) => {
  await page.goto('/blog/map/');
  await expect(page.getByRole('button', { name: '查看此处的 4 篇文章' })).toBeEnabled();
  // The SDK supplies the current zoom; retain a large pixel-grid cluster at its limit.
  await page.evaluate(() => {
    Reflect.get(window, '__hpmSdk').maps[0].zoom = 18;
  });
  await page.getByRole('button', { name: '查看此处的 4 篇文章' }).click();
  await expect(page.getByRole('dialog', { name: '4 篇文章' }).locator('li')).toHaveCount(4);
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].zoom)).toBe(18);
});

test('SDK failure and later map errors reveal the overview fallback', async ({ page }) => {
  await page.goto('/blog/map/');
  await expect(page.locator('[data-hpm-show-list]')).toBeVisible();
  await expect(page.locator('[data-hpm-status]')).toBeEmpty();
  await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].emit('error'));
  await expect(page.locator('[data-hpm-fallback]')).toBeVisible();
  await expect(page.locator('[data-hpm-status]')).toContainText('无法加载');
  await page.route('https://webapi.amap.com/**', (route) => route.abort());
  await page.reload();
  await expect(page.locator('[data-hpm-status]')).toContainText('无法加载');
  await expect(page.locator('[data-hpm-fallback] a')).toHaveCount(4);
});
