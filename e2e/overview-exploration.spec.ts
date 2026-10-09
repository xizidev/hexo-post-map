import type { Page } from 'playwright/test';
import { expect, installOverviewExplorationFixture, test } from './fixtures';

const flags = { restore: true, share: true, random: false };

for (const mobile of [false, true]) {
  for (const fontSize of [16, 32]) {
    test(`copy confirmation stays compact and dismisses on ${mobile ? 'mobile' : 'desktop'} at ${fontSize}px text`, async ({
      page,
    }) => {
      await page.setViewportSize(
        mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      );
      await installOverviewExplorationFixture(page, {
        count: 30,
        flags: { ...flags, random: true },
      });
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: async () => undefined },
        });
      });
      await page.goto('/blog/map/');
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size + 'px';
      }, fontSize);
      const share = page.getByRole('button', { name: '分享地图' });
      await expect(share).toBeVisible();
      const toolbar = page.locator('[data-hpm-toolbar]');
      const before = await toolbar.boundingBox();
      await share.click();
      const status = page.locator('[data-hpm-share-status]');
      await expect(status).toHaveText('链接已复制');
      const toolbarBox = (await toolbar.boundingBox())!;
      const statusBox = (await status.boundingBox())!;
      const shareBox = (await share.boundingBox())!;
      const canvasBox = (await page.locator('[data-hpm-canvas]').boundingBox())!;
      expect(statusBox.width).toBeLessThan(toolbarBox.width * 0.8);
      expect(toolbarBox.height).toBeCloseTo(before!.height, 0);
      expect(statusBox.x + statusBox.width).toBeCloseTo(shareBox.x + shareBox.width, 0);
      expect(statusBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height);
      expect(statusBox.x).toBeGreaterThanOrEqual(canvasBox.x);
      expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width);
      await expect(status).toBeEmpty({ timeout: 5000 });
      await expect(share).toBeFocused();
    });
  }
}

for (const panelMode of ['single', 'all'] as const) {
  for (const fontSize of [16, 32]) {
    test(`copy confirmation stays above the ${panelMode} article panel at ${fontSize}px text`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await installOverviewExplorationFixture(page, {
        count: 30,
        flags: { ...flags, random: true },
      });
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: async () => undefined },
        });
      });
      await page.goto('/blog/map/');
      await expect(page.getByRole('button', { name: '分享地图' })).toBeVisible();
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size + 'px';
      }, fontSize);
      if (panelMode === 'single') {
        await changeView(page);
        await page
          .getByRole('button', { name: '预览文章：Exploration article 7', exact: true })
          .click();
      } else {
        await page.getByRole('button', { name: /^全部文章/ }).click();
      }
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: '分享地图' }).click();
      const status = page.locator('[data-hpm-share-status]');
      await expect(status).toHaveText('链接已复制');
      expect(
        await status.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const text = range.getBoundingClientRect();
          const previousPointerEvents = element.style.pointerEvents;
          // Hit-test the painted text, rather than only checking DOM presence.
          element.style.pointerEvents = 'auto';
          try {
            return [0.2, 0.5, 0.8].every((fraction) => {
              const topmost = document.elementFromPoint(
                text.left + text.width * fraction,
                text.top + text.height / 2,
              );
              return topmost === element || (topmost !== null && element.contains(topmost));
            });
          } finally {
            element.style.pointerEvents = previousPointerEvents;
          }
        }),
      ).toBe(true);
      await page.getByRole('button', { name: '关闭文章面板' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(status).toBeEmpty({ timeout: 5000 });
    });
  }
}

test('wrapped toolbar does not block the article panel close button at large text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 620, height: 900 });
  await installOverviewExplorationFixture(page, {
    count: 30,
    flags: { ...flags, random: true },
  });
  await page.goto('/blog/map/');
  await expect(page.getByRole('button', { name: '分享地图' })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  await page.getByRole('button', { name: /^全部文章/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '关闭文章面板' }).click({ timeout: 3000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

async function clickVisibleArticle(page: Page): Promise<void> {
  const scroller = page.locator('.hpm-panel__scroller');
  const index = await scroller.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll('.hpm-post__link')).findIndex((card) => {
      const box = card.getBoundingClientRect();
      return box.top >= bounds.top && box.bottom <= bounds.bottom;
    });
  });
  expect(index).toBeGreaterThanOrEqual(0);
  await scroller.locator('.hpm-post__link').nth(index).click();
}

test('new tab share wins over receiver cache', async ({ page, context, network }) => {
  await installOverviewExplorationFixture(page, { count: 30, flags });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (link: string) => Reflect.set(window, '__copiedLink', link) },
    }),
  );
  await page.goto('/blog/map/');
  await expect(page.getByRole('button', { name: '分享地图' })).toBeVisible();
  await changeView(page, [110, 30], 8);
  await page.getByRole('button', { name: /^全部文章/ }).click();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('hexo-post-map.overview-state.v1')))
    .not.toBeNull();
  const cached = await page.evaluate(() =>
    sessionStorage.getItem('hexo-post-map.overview-state.v1')!,
  );
  await page.getByRole('button', { name: '关闭文章面板' }).click();
  await changeView(page);
  await page.getByRole('button', { name: '预览文章：Exploration article 7', exact: true }).click();
  await page.getByRole('button', { name: '分享地图' }).click();
  await expect(page.locator('[data-hpm-share-status]')).toHaveText('链接已复制');
  const link = await page.evaluate(() => Reflect.get(window, '__copiedLink') as string);
  expect([...new URL(link).searchParams.keys()]).toEqual([
    'hpm_v',
    'hpm_center',
    'hpm_zoom',
    'hpm_post',
  ]);
  expect(new URL(link).searchParams.get('hpm_post')).toBe('/blog/posts/plain/?hpm_fixture=7');
  expect(link).not.toMatch(/hpm-build-only|security|source|tracks|image|proxy/u);
  expect(JSON.parse(cached).scopes[0].snapshot).toMatchObject({
    view: { center: [110, 30], zoom: 8 },
    panel: { mode: 'all' },
  });
  expect(Object.keys(JSON.parse(cached).scopes[0].snapshot).sort()).toEqual([
    'panel',
    'savedAt',
    'version',
    'view',
  ]);
  expect(cached).not.toMatch(/hpm-build-only|security|source|tracks|image|proxy/u);
  const receiver = await context.newPage();
  await installOverviewExplorationFixture(receiver, { count: 30, flags });
  await receiver.addInitScript(
    (cache) => sessionStorage.setItem('hexo-post-map.overview-state.v1', cache),
    cached,
  );
  await receiver.goto(link);
  await expect(
    receiver.getByRole('dialog', { name: '1 篇文章' }).locator('.hpm-post__link'),
  ).toHaveAttribute('href', '/blog/posts/plain/?hpm_fixture=7');
  await expect(receiver.getByRole('button', { name: '关闭文章面板' })).not.toBeFocused();
  await expect(receiver).toHaveURL(link);
  expect(
    await receiver.evaluate(() => {
      const map = Reflect.get(window, '__hpmSdk').maps[0];
      return [map.getCenter().getLng(), map.getCenter().getLat(), map.getZoom()];
    }),
  ).toEqual([121.4737, 31.2304, 12.25]);
  expectNoExtraData(network.local);
  await receiver.close();
});

for (const query of [
  'hpm_v=1&hpm_center=121,31&hpm_zoom=12&hpm_zoom=13',
  'hpm_v=1&hpm_center=121,31&hpm_zoom=12&hpm_unknown=1',
  'hpm_v=1&hpm_center=999,31&hpm_zoom=12',
]) {
  test(`invalid share leaves normal initial view: ${query}`, async ({ page, network }) => {
    await installOverviewExplorationFixture(page, { count: 30, flags });
    await page.goto(`/blog/map/?${query}`);
    await expect(page.getByRole('button', { name: '分享地图' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].getZoom())).toBe(4);
    await expect(page).toHaveURL(`http://127.0.0.1:4179/blog/map/?${query}`);
    expectNoExtraData(network.local);
  });
}

test('replacement while pending cannot mutate new root', async ({ page }) => {
  await installOverviewExplorationFixture(page, { count: 30, flags });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: () =>
          new Promise<void>((_resolve, reject) => Reflect.set(window, '__rejectCopy', reject)),
      },
    }),
  );
  await page.goto('/blog/map/');
  await page.getByRole('button', { name: '分享地图' }).click();
  await page.locator('[data-hpm-overview]').evaluate((old) => {
    const replacement = old.cloneNode(true) as HTMLElement;
    replacement
      .querySelectorAll('[data-hpm-toolbar], .hpm-panel, [data-hpm-share-manual]')
      .forEach((node) => node.remove());
    replacement.querySelector('[data-hpm-canvas]')!.replaceChildren();
    old.replaceWith(replacement);
  });
  await expect(page.getByRole('button', { name: '分享地图' })).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__hpmSdk').maps.length)).toBe(2);
  await page.evaluate(() => Reflect.get(window, '__rejectCopy')(new Error('late denied')));
  await expect(page.locator('[data-hpm-share-manual]')).toHaveCount(0);
  await expect(page.locator('[data-hpm-share-status]')).toBeEmpty();
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').destroyedMaps)).toBe(1);
});

for (const mobile of [false, true]) {
  test(`large-list scroll keeps row nodes and loaded-image requests stable on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
    network,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await installOverviewExplorationFixture(page, {
      count: 1000,
      flags: { ...flags, random: true },
    });
    await page.goto('/blog/map/');
    await page.getByRole('button', { name: /^全部文章/ }).click();
    const scroller = page.locator('.hpm-panel__scroller');
    await expect(scroller.locator('li')).toHaveCount(1000);
    await expect
      .poll(() =>
        scroller
          .locator('img')
          .first()
          .evaluate((image: HTMLImageElement) => image.complete),
      )
      .toBe(true);
    // Wait for the finite open checkpoint, then count every geometry read, not only row reads.
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('hexo-post-map.overview-state.v1')))
      .not.toBeNull();
    const requests = network.local['/blog/hexo-post-map/assets/placeholder.svg'];
    await scroller.evaluate((element) => {
      Reflect.set(window, '__originalRows', [...element.querySelectorAll('li')]);
      Reflect.set(window, '__measurements', 0);
      const original = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        Reflect.set(window, '__measurements', Reflect.get(window, '__measurements') + 1);
        return original.call(this);
      };
      for (let index = 0; index < 50; index++) {
        element.scrollTop = 400 + index * 5;
        element.dispatchEvent(new Event('scroll'));
      }
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const value = sessionStorage.getItem('hexo-post-map.overview-state.v1');
          return value && JSON.parse(value).scopes[0].snapshot.panel.scroll.top;
        }),
      )
      .toBe(645);
    expect(await page.evaluate(() => Reflect.get(window, '__measurements'))).toBeLessThanOrEqual(
      14,
    );
    expect(
      await scroller.evaluate((element) =>
        [...element.querySelectorAll('li')].every(
          (row, index) => row === Reflect.get(window, '__originalRows')[index],
        ),
      ),
    ).toBe(true);
    expect(network.local['/blog/hexo-post-map/assets/placeholder.svg']).toBe(requests);
    expectNoExtraData(network.local);
  });
}

test('refresh preserves one controller and reload restores the latest view', async ({
  page,
  network,
}) => {
  await installOverviewExplorationFixture(page, { count: 30, flags });
  await page.goto('/blog/map/');
  await expect(page.getByRole('button', { name: '分享地图' })).toBeVisible();
  await changeView(page);
  await page.getByRole('button', { name: /^全部文章/ }).click();
  await page.evaluate(() => {
    for (let index = 0; index < 5; index++) Reflect.get(window, 'HexoPostMap').refresh();
  });
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps.length)).toBe(1);
  await expect(page.locator('[data-hpm-toolbar]')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps.length)).toBe(1);
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].getZoom())).toBe(12.25);
  await expect(page.getByRole('button', { name: '关闭文章面板' })).not.toBeFocused();
  expectNoExtraData(network.local);
});

test('throwing storage restores through bounded document memory and keeps sharing usable', async ({
  page,
}) => {
  await installOverviewExplorationFixture(page, { count: 30, flags });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new Error('blocked');
      },
    });
    Object.defineProperty(navigator, 'clipboard', { value: undefined });
  });
  await page.goto('/blog/map/');
  await expect(page.getByRole('button', { name: '分享地图' })).toBeVisible();
  await changeView(page);
  await page.getByRole('button', { name: /^全部文章/ }).click();
  await page.locator('[data-hpm-overview]').evaluate((root) => {
    Reflect.get(window, 'HexoPostMap').destroy(root.parentElement);
    Reflect.get(window, 'HexoPostMap').refresh(root.parentElement);
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭文章面板' })).not.toBeFocused();
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps.at(-1).getZoom())).toBe(
    12.25,
  );
  await page.getByRole('button', { name: '关闭文章面板' }).click();
  await page.getByRole('button', { name: '分享地图' }).click();
  await expect(page.getByRole('textbox', { name: '地图分享链接（请手动复制）' })).toBeFocused();
});

test('explicit flags off ignore incoming share without disabling the map', async ({
  page,
  network,
}) => {
  await installOverviewExplorationFixture(page, {
    count: 30,
    flags: { restore: false, share: false, random: false },
  });
  await page.goto(
    '/blog/map/?hpm_v=1&hpm_center=121,31&hpm_zoom=12&hpm_post=%2Fblog%2Fposts%2Fplain%2F%3Fhpm_fixture%3D1',
  );
  await expect(page.getByRole('button', { name: /^全部文章/ })).toBeVisible();
  await expect(page.locator('[data-hpm-share], [data-hpm-random], .hpm-panel')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].getZoom())).toBe(4);
  expectNoExtraData(network.local);
});

test('ambiguous article reference degrades to shared view without creating navigation', async ({
  page,
  network,
}) => {
  // Retain the existing repeated-URL corpus alongside the unique synthetic fixture.
  await page.route('**/blog/map/posts.json', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.posts.push({ ...data.posts[0], title: 'Ambiguous duplicate' });
    await route.fulfill({ response, json: data });
  });
  await page.goto(
    '/blog/map/?hpm_v=1&hpm_center=121,31&hpm_zoom=12&hpm_post=%2Fblog%2Fposts%2Foverlap%2F',
  );
  await expect(page.getByRole('button', { name: '分享地图' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].getZoom())).toBe(12);
  expectNoExtraData(network.local);
});

test('legacy HTML keeps map and all-post list without exploration controls', async ({ page }) => {
  await page.route('**/blog/map/', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /(<script type="application\/json" data-hpm-data>)([\s\S]*?)(<\/script>)/u,
      (_all, start: string, json: string, end: string) => {
        const config = JSON.parse(json);
        delete config.exploration;
        delete config.overviewUrl;
        return start + JSON.stringify(config) + end;
      },
    );
    await route.fulfill({ response, body });
  });
  await page.goto('/blog/map/');
  await expect(page.locator('[data-hpm-overview]')).toHaveAttribute('data-hpm-active', 'true');
  await expect(page.getByRole('button', { name: /^全部文章/ })).toBeVisible();
  await expect(page.locator('[data-hpm-share], [data-hpm-random]')).toHaveCount(0);
});

async function changeView(page: Page, center = [121.4737, 31.2304], zoom = 12.25) {
  await page.evaluate(
    ({ center, zoom }) =>
      Reflect.get(window, '__hpmSdk').maps.at(-1).setZoomAndCenter(zoom, center, true),
    { center, zoom },
  );
}

async function denyClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
  });
}

function expectNoExtraData(local: Record<string, number>, clickedArticlePath?: string) {
  expect(
    Object.keys(local).filter(
      (path) => path.includes('/hexo-post-map/tracks/') || /\.(gpx|geojson)$/u.test(path),
    ),
  ).toEqual([]);
  expect(
    Object.fromEntries(Object.entries(local).filter(([path]) => path.includes('/posts/'))),
  ).toEqual(clickedArticlePath ? { [clickedArticlePath]: 1 } : {});
}

test('article request guard accepts only the one clicked article request', () => {
  expectNoExtraData({ '/blog/posts/plain/': 1 }, '/blog/posts/plain/');
});

const extraArticleRequests: { name: string; local: Record<string, number> }[] = [
  {
    name: 'another article pathname',
    local: { '/blog/posts/plain/': 1, '/blog/posts/other/': 1 },
  },
  {
    name: 'a second request with the same pathname (including a different fixture query)',
    local: { '/blog/posts/plain/': 2 },
  },
];
for (const { name, local } of extraArticleRequests) {
  test(`article request guard rejects ${name}`, () => {
    expect(() => expectNoExtraData(local, '/blog/posts/plain/')).toThrow();
  });
}

for (const mobile of [false, true]) {
  test.describe(mobile ? 'mobile exploration' : 'desktop exploration', () => {
    test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });

    test('returns with view panel and scroll but no stolen focus', async ({
      page,
      context,
      network,
    }) => {
      const articleRequests: string[] = [];
      context.on('request', (request) => {
        const url = new URL(request.url());
        if (url.origin === 'http://127.0.0.1:4179' && url.pathname.includes('/posts/'))
          articleRequests.push(url.href);
      });
      await installOverviewExplorationFixture(page, { count: 30, flags });
      await page.addInitScript(() => Reflect.set(window, '__hpmDocumentId', Math.random()));
      await page.goto('/blog/map/');
      // Missing SDK view capabilities must fail at a user-visible control, not a helper call.
      await expect(page.getByRole('button', { name: '分享地图' })).toBeVisible();
      await changeView(page);
      await page.getByRole('button', { name: /^全部文章/ }).click();
      const scroller = page.locator('.hpm-panel__scroller');
      await scroller.evaluate((node) => {
        node.scrollTop = 400;
      });
      const documentId = await page.evaluate(() => Reflect.get(window, '__hpmDocumentId'));
      const pagePosition = await page.evaluate(() => [scrollX, scrollY]);
      expectNoExtraData(network.local);
      await clickVisibleArticle(page);
      await expect(page).toHaveURL(/\/blog\/posts\/plain\/\?hpm_fixture=\d+$/u);
      const clickedArticleUrl = page.url();
      await page.goBack();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await page.evaluate(() => Reflect.get(window, '__hpmDocumentId'))).not.toBe(
        documentId,
      );
      await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(400);
      await expect(page.getByRole('button', { name: '关闭文章面板' })).not.toBeFocused();
      expect(await page.evaluate(() => [scrollX, scrollY])).toEqual(pagePosition);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const map = Reflect.get(window, '__hpmSdk').maps[0];
            const center = map.getCenter();
            return [center.getLng(), center.getLat(), map.getZoom()];
          }),
        )
        .toEqual([121.4737, 31.2304, 12.25]);
      expectNoExtraData(network.local, new URL(clickedArticleUrl).pathname);
      expect(articleRequests).toEqual([clickedArticleUrl]);
    });

    test('clipboard denied is keyboard-operable', async ({ page, network }) => {
      await installOverviewExplorationFixture(page, { count: 30, flags });
      await denyClipboard(page);
      await page.goto('/blog/map/');
      const share = page.getByRole('button', { name: '分享地图' });
      await expect(share).toBeVisible();
      await changeView(page);
      await share.focus();
      await page.keyboard.press('Enter');
      const input = page.getByRole('textbox', { name: '地图分享链接（请手动复制）' });
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(
        'http://127.0.0.1:4179/blog/map/?hpm_v=1&hpm_center=121.4737%2C31.2304&hpm_zoom=12.25',
      );
      expect(
        await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd]),
      ).toEqual([0, (await input.inputValue()).length]);
      await page.keyboard.press('Tab');
      await expect(page.locator('[data-hpm-share-close]')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(input).toHaveCount(0);
      await expect(share).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(input).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(share).toBeFocused();
      expectNoExtraData(network.local);
    });

    test('random preview does not navigate', async ({ page, network }) => {
      await installOverviewExplorationFixture(page, {
        count: 30,
        flags: { ...flags, random: true },
      });
      await page.addInitScript(() => {
        Math.random = () => 0;
      });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/blog/map/');
      const random = page.getByRole('button', { name: '随机一站' });
      await expect(random).toBeVisible();
      const historyLength = await page.evaluate(() => {
        history.replaceState({ theme: 'owned' }, '');
        history.scrollRestoration = 'manual';
        return history.length;
      });
      await random.click();
      const dialog = page.getByRole('dialog', { name: '1 篇文章' });
      await expect(dialog.locator('.hpm-post__link')).toHaveAttribute(
        'href',
        '/blog/posts/plain/?hpm_fixture=0',
      );
      await expect(page).toHaveURL('http://127.0.0.1:4179/blog/map/');
      await expect(page.getByRole('button', { name: '关闭文章面板' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(random).toBeFocused();
      await random.click();
      await expect(dialog.locator('.hpm-post__link')).toHaveAttribute(
        'href',
        '/blog/posts/plain/?hpm_fixture=1',
      );
      expect(
        await page.evaluate(() => ({
          length: history.length,
          state: history.state,
          scrollRestoration: history.scrollRestoration,
        })),
      ).toEqual({ length: historyLength, state: { theme: 'owned' }, scrollRestoration: 'manual' });
      expect(
        await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].lastImmediately),
      ).toBe(true);
      expect(
        await page.evaluate(() => {
          const map = Reflect.get(window, '__hpmSdk').maps[0];
          return [map.getCenter().getLng(), map.getCenter().getLat(), map.getZoom()];
        }),
      ).toEqual([118.0001, 32, 11]);
      expectNoExtraData(network.local);
    });
  });
}
