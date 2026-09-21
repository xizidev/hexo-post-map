import { test, expect } from './fixtures';

for (const mobile of [false, true]) {
  for (const rootFontSize of [16, 32])
    test(`article panel resists Cactus rules at ${rootFontSize}px root size on ${mobile ? 'mobile' : 'desktop'}`, async ({
      page,
    }) => {
      await page.setViewportSize(
        mobile ? { width: 390, height: 900 } : { width: 1440, height: 900 },
      );
      await page.addInitScript(() => {
        document.addEventListener(
          'DOMContentLoaded',
          () => {
            const root = document.querySelector('[data-hpm-overview]');
            if (!root) return;
            const article = document.createElement('article');
            const content = document.createElement('div');
            content.className = 'content';
            root.replaceWith(article);
            article.append(content);
            content.append(root);
          },
          { once: true },
        );
      });
      await page.route('**/map/posts.json', (route) =>
        route.fulfill({
          json: {
            version: 1,
            posts: [
              {
                title: 'A very long portrait article title that must remain inside two lines',
                url: '/blog/posts/route/',
                image: '/blog/test-images/portrait.svg',
                date: '2025-06-02T00:00:00Z',
                location: {
                  name: 'A very long location that must be truncated instead of growing the card',
                  longitude: 121,
                  latitude: 31,
                },
              },
              {
                title: 'Landscape article',
                url: '/blog/posts/route/',
                image: '/blog/test-images/landscape.svg',
                date: '2025-06-01T00:00:00Z',
                location: { name: 'Shanghai', longitude: 122, latitude: 32 },
              },
            ],
          },
        }),
      );
      await page.route('**/test-images/portrait.svg', (route) =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600"/>',
        }),
      );
      await page.route('**/test-images/landscape.svg', (route) =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"/>',
        }),
      );
      await page.goto('/blog/map/');
      await page.addStyleTag({
        content: `
        html {
          font-size: ${rootFontSize}px;
        }
        article .content h2::before {
          content: '#';
          position: relative;
          left: -1rem;
          color: rgb(255, 0, 0);
        }
        article .content img {
          display: block;
          max-width: 100%;
          height: auto;
          margin: 2rem auto;
        }
      `,
      });
      await page.getByRole('button', { name: '全部文章 2', exact: true }).click();
      const panel = page.getByRole('dialog', { name: '2 篇文章', exact: true });
      const heading = panel.locator('.hpm-panel__title');
      const cards = panel.locator('.hpm-post__link');
      const images = panel.locator('.hpm-post__image');
      expect(await cards.count()).toBe(2);
      expect(await images.count()).toBe(2);
      const geometry = await page.evaluate(() => ({
        rootFontSize: getComputedStyle(document.documentElement).fontSize,
        cards: Array.from(document.querySelectorAll('.hpm-panel .hpm-post__link')).map(
          (element) => {
            const bounds = element.getBoundingClientRect();
            const title = element.querySelector<HTMLElement>('.hpm-post__title')!;
            const date = element.querySelector<HTMLElement>('.hpm-post__date')!;
            const location = element.querySelector<HTMLElement>('.hpm-post__location')!;
            const titleBounds = title.getBoundingClientRect();
            const dateBounds = date.getBoundingClientRect();
            const locationBounds = location.getBoundingClientRect();
            return {
              bounds: [bounds.width, bounds.height],
              containsText:
                titleBounds.top >= bounds.top - 0.5 && locationBounds.bottom <= bounds.bottom + 0.5,
              titleLines:
                titleBounds.height / Number.parseFloat(getComputedStyle(title).lineHeight),
              textOrder:
                titleBounds.bottom <= dateBounds.top + 0.5 &&
                dateBounds.bottom <= locationBounds.top + 0.5,
            };
          },
        ),
        images: Array.from(document.querySelectorAll('.hpm-panel .hpm-post__image')).map(
          (element) => {
            const bounds = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
              bounds: [bounds.width, bounds.height],
              objectFit: style.objectFit,
              objectPosition: style.objectPosition,
              margin: style.margin,
            };
          },
        ),
      }));
      expect(geometry.rootFontSize).toBe(`${rootFontSize}px`);
      expect(new Set(geometry.cards.map(({ bounds: [, height] }) => height)).size).toBe(1);
      if (rootFontSize === 16) expect(geometry.cards[0]!.bounds[1]).toBe(100);
      expect(geometry.cards.every(({ containsText }) => containsText)).toBe(true);
      expect(geometry.cards.every(({ titleLines }) => titleLines <= 2.01)).toBe(true);
      expect(geometry.cards.every(({ textOrder }) => textOrder)).toBe(true);
      expect(new Set(geometry.images.map(({ bounds }) => bounds.join('x'))).size).toBe(1);
      expect(geometry.images[0]!.bounds[0] / geometry.images[0]!.bounds[1]).toBeCloseTo(4 / 3, 2);
      expect(geometry.images.every(({ objectFit }) => objectFit === 'cover')).toBe(true);
      expect(geometry.images.every(({ objectPosition }) => objectPosition === '50% 50%')).toBe(
        true,
      );
      expect(geometry.images.every(({ margin }) => margin === '0px')).toBe(true);
      await expect(panel.locator('.hpm-post__title').first()).toHaveCSS('overflow', 'hidden');
      await expect(panel.locator('.hpm-post__date').first()).toHaveCSS('white-space', 'nowrap');
      await expect(panel.locator('.hpm-post__location').first()).toHaveCSS(
        'text-overflow',
        'ellipsis',
      );
      expect(
        await heading.evaluate((element) => getComputedStyle(element, '::before').content),
      ).toBe('none');
      await expect(heading).toHaveText('2 篇文章');
    });

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
    const initialClusterBounds = (await initialCluster.boundingBox())!;
    expect(initialClusterBounds.width).toBeGreaterThanOrEqual(44);
    expect(initialClusterBounds.height).toBeGreaterThanOrEqual(44);
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
    ).toEqual(mobile ? { x: -32, y: -62 } : { x: -36, y: -68 });
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
    const closeBounds = (await panel.getByRole('button', { name: '关闭文章面板' }).boundingBox())!;
    expect(closeBounds.width).toBeGreaterThanOrEqual(44);
    expect(closeBounds.height).toBeGreaterThanOrEqual(44);
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
