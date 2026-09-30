import type { Locator, Page } from 'playwright/test';
import {
  expect,
  fireAnimationFrame,
  installControlledAnimationFrames,
  installTrackedPage,
  pendingAnimationFrames,
  test,
  TRACK_ASSET_PATH,
} from './fixtures';

async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  if (await target.evaluate((element) => element === document.activeElement))
    await page.keyboard.press('Shift+Tab');
  for (let press = 0; press < 30; press++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
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
    await expect(page.locator('[data-hpm-overview]')).toHaveCSS('display', 'block');
    const mapBounds = await page.locator('[data-hpm-canvas]').boundingBox();
    expect((await fallback.boundingBox())!.y).toBeGreaterThanOrEqual(
      mapBounds!.y + mapBounds!.height,
    );
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

  test('tracked detail keeps server-rendered statistics and inert controls readable', async ({
    page,
    network,
  }) => {
    await installTrackedPage(page);
    await page.goto('/blog/posts/route/');
    const statistics = page.locator('[data-hpm-track-stats]');
    await expect(statistics).toBeVisible();
    await expect(statistics.locator('dt')).toHaveText(['距离', '累计爬升', '时长']);
    await expect(statistics.locator('dd')).toHaveText(['12.35 公里', '343 米', '1 小时 30 分钟']);
    await expect(page.locator('[data-hpm-playback]')).toBeHidden();
    await expect(page.locator('[data-hpm-fallback]')).toBeVisible();
    expect(network.local[TRACK_ASSET_PATH] ?? 0).toBe(0);
    expect(network.sdkRequests).toBe(0);
  });
});

test('track controls preserve native keyboard order, value text, focus, and quiet status', async ({
  page,
}) => {
  await installControlledAnimationFrames(page);
  await installTrackedPage(page);
  await page.goto('/blog/posts/route/');
  const play = page.getByRole('button', { name: '播放', exact: true });
  const restart = page.getByRole('button', { name: '重新开始', exact: true });
  const range = page.getByRole('slider', { name: '轨迹播放进度' });
  const status = page.locator('[data-hpm-status]');
  await tabTo(page, play);
  await expect(play).toHaveCSS('outline-style', 'solid');
  await expect(play).toHaveCSS('outline-width', '3px');
  await page.keyboard.press('Tab');
  await expect(restart).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(range).toBeFocused();
  await expect(range).toHaveCSS('outline-style', 'solid');
  await expect(range).toHaveCSS('outline-width', '3px');

  await page.keyboard.press('ArrowRight');
  await expect(range).toHaveValue('0.001');
  await expect(range).toHaveAttribute('aria-valuetext', '行程进度 0%');
  await page.keyboard.press('End');
  await expect(range).toHaveValue('1');
  await expect(range).toHaveAttribute('aria-valuetext', '行程进度 100%');
  await page.keyboard.press('Home');
  await expect(range).toHaveValue('0');
  await expect(range).toHaveAttribute('aria-valuetext', '行程进度 0%');

  await status.evaluate((element) => {
    Reflect.set(window, '__hpmStatusWrites', 0);
    new MutationObserver(() => {
      Reflect.set(window, '__hpmStatusWrites', Reflect.get(window, '__hpmStatusWrites') + 1);
    }).observe(element, { childList: true, characterData: true, subtree: true });
  });
  await play.click();
  await fireAnimationFrame(page, 1_000);
  await fireAnimationFrame(page, 16_000);
  expect(await page.evaluate(() => Reflect.get(window, '__hpmStatusWrites'))).toBe(0);
  await expect(status).toBeEmpty();
});

test('runtime reduced motion disables continuous playback but keeps seeking at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await installControlledAnimationFrames(page);
  await page.addInitScript(() => {
    const layout = Array.from({ length: 7 }, () => ({}));
    layout[6] = { left: 'calc(50% - 8px)', top: 'calc(50% - 8px)' };
    Reflect.set(window, '__hpmSdkMarkerLayout', layout);
  });
  await installTrackedPage(page);
  await page.goto('/blog/posts/route/');
  const root = page.locator('[data-hpm-detail]');
  const controls = root.locator('[data-hpm-playback]');
  const play = root.locator('[data-hpm-play]');
  const restart = root.locator('[data-hpm-restart]');
  const range = root.getByRole('slider', { name: '轨迹播放进度' });
  await expect(controls).toBeVisible();
  await expect(play).toBeVisible();
  await expect(restart).toBeVisible();
  await play.click();
  expect(await pendingAnimationFrames(page)).toBe(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(play).toBeHidden();
  await expect(restart).toBeHidden();
  await expect(range).toBeVisible();
  expect(await pendingAnimationFrames(page)).toBe(0);
  await range.focus();
  await page.keyboard.press('End');
  await expect(range).toHaveValue('1');
  await expect(range).toHaveAttribute('aria-valuetext', '行程进度 100%');
  expect(await pendingAnimationFrames(page)).toBe(0);
  const layout = await root.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const controls = element.querySelector<HTMLElement>('[data-hpm-playback]')!;
    const controlsBounds = controls.getBoundingClientRect();
    return {
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      controlsInside:
        controlsBounds.left >= bounds.left && controlsBounds.right <= bounds.right + 0.5,
      rangeWidth: element.querySelector<HTMLInputElement>('[data-hpm-progress]')!.offsetWidth,
      markerSize: getComputedStyle(element.querySelector<HTMLElement>('.hpm-track-marker')!).width,
    };
  });
  expect(layout.pageOverflow).toBeLessThanOrEqual(0);
  expect(layout.controlsInside).toBe(true);
  expect(layout.rangeWidth).toBeGreaterThanOrEqual(44);
  expect(layout.markerSize).not.toBe('auto');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`track colors remain distinguishable in the ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await installTrackedPage(page);
    await page.goto('/blog/posts/route/');
    const ratios = await page.locator('[data-hpm-detail]').evaluate((element) => {
      const style = getComputedStyle(element);
      const parse = (value: string) =>
        /^#[0-9a-f]{6}$/iu.test(value)
          ? [
              Number.parseInt(value.slice(1, 3), 16),
              Number.parseInt(value.slice(3, 5), 16),
              Number.parseInt(value.slice(5, 7), 16),
            ]
          : (value.match(/[\d.]+/gu) ?? []).slice(0, 3).map((component) => Number(component));
      const luminance = (components: number[]) => {
        const [red = 0, green = 0, blue = 0] = components.map((component) => {
          const channel = component / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const surface = luminance(parse(style.getPropertyValue('--hpm-surface')));
      const contrast = (value: string) => {
        const foreground = luminance(parse(value));
        return (Math.max(surface, foreground) + 0.05) / (Math.min(surface, foreground) + 0.05);
      };
      const track = style.getPropertyValue('--hpm-track-color').trim();
      const progress = style.getPropertyValue('--hpm-track-progress-color').trim();
      return { track, progress, trackRatio: contrast(track), progressRatio: contrast(progress) };
    });
    expect(ratios.track).toMatch(/^#[0-9a-f]{6}$/u);
    expect(ratios.progress).toMatch(/^#[0-9a-f]{6}$/u);
    expect(ratios.trackRatio).toBeGreaterThanOrEqual(4.5);
    expect(ratios.progressRatio).toBeGreaterThanOrEqual(4.5);
  });
}

for (const mobile of [false, true]) {
  test(`reduced motion and automatic keyboard map navigation on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/blog/map/');
    expect(await page.locator('[data-hpm-activate]').count()).toBe(0);
    const allPosts = page.getByRole('button', { name: '查看此处的 4 篇文章' });
    await tabTo(page, allPosts);
    await page.evaluate(() => {
      document.documentElement.dataset.hpmObservedTabs = '0';
      document.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab') return;
        const count = Number(document.documentElement.dataset.hpmObservedTabs ?? '0');
        document.documentElement.dataset.hpmObservedTabs = String(count + 1);
      });
    });
    await tabTo(page, allPosts);
    expect(
      await page
        .locator('html')
        .evaluate((element) => Number((element as HTMLElement).dataset.hpmObservedTabs ?? '0')),
    ).toBeGreaterThan(0);
    await page.keyboard.press('Enter');
    const overlap = page.getByRole('button', { name: '查看此处的 2 篇文章' });
    await tabTo(page, overlap);
    await page.keyboard.press('Enter');
    const group = page.getByRole('dialog', { name: '2 篇文章' });
    await expect(group.locator('li')).toHaveCount(2);
    await expect(group.getByRole('button', { name: '关闭文章面板' })).toBeFocused();
    await expect(group).toHaveCSS('transition-duration', '0s');
    await expect(group).toHaveCSS('animation-name', 'none');
    await expect(overlap).toHaveCSS('transition-duration', '0s');
    expect(
      await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].options.animateEnable),
    ).toBe(false);
    await page.keyboard.press('Escape');
    await expect(overlap).toBeFocused();
    await tabTo(page, page.getByRole('button', { name: '预览文章：Mountain itinerary' }));
    await page.keyboard.press('Enter');
    const preview = page.getByRole('dialog', { name: '1 篇文章' });
    await expect(preview.locator('a')).toHaveCount(1);
    await tabTo(page, preview.locator('a.hpm-post__link'));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/blog\/posts\/route\/$/);
    await expect(page.locator('[data-hpm-detail]')).toHaveAttribute('data-hpm-active', 'true');
    const canvas = page.locator('[data-hpm-canvas]');
    await expect(canvas).toHaveAttribute(
      'aria-label',
      '文章地点地图：Summit GCJ-02、Visitor center GCJ-02、Cableway GCJ-02',
    );
    await tabTo(page, canvas);
    await page.keyboard.press('ArrowRight');
    await expect(canvas).toBeFocused();
    expect(
      await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].status.keyboardEnable),
    ).toBe(true);
    await expect(canvas.locator('button')).toHaveCount(3);
    await expect(canvas.locator('a')).toHaveCount(0);
    const firstPin = canvas.locator('.hpm-detail-marker').first();
    await tabTo(page, firstPin);
    await page.keyboard.press('Enter');
    await expect(firstPin).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(firstPin).toBeFocused();
    await expect(page.locator('[data-hpm-fallback]')).toBeHidden();
    expect(
      await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].options.animateEnable),
    ).toBe(false);
    await expect(page.locator('[data-hpm-activate]')).toHaveCount(0);
    await expect(page.locator('[data-hpm-status]')).toBeEmpty();
    await expect(
      page.getByText('The route differs from point declaration order to detect incorrect sorting.'),
    ).toBeVisible();
  });
}

test('forced colors preserve theme semantics, visible focus, and 44px controls', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/blog/map/');
  const root = page.locator('[data-hpm-overview]');
  expect(
    await root.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        accent: style.getPropertyValue('--hpm-accent').trim(),
        contrast: style.getPropertyValue('--hpm-accent-contrast').trim(),
        cluster: style.getPropertyValue('--hpm-cluster-surface').trim(),
        panel: style.getPropertyValue('--hpm-panel-surface').trim(),
        text: style.getPropertyValue('--hpm-text').trim(),
        muted: style.getPropertyValue('--hpm-muted').trim(),
      };
    }),
  ).toEqual({
    accent: 'Highlight',
    contrast: 'HighlightText',
    cluster: 'Highlight',
    panel: 'Canvas',
    text: 'CanvasText',
    muted: 'GrayText',
  });

  const cluster = page.getByRole('button', { name: '查看此处的 4 篇文章' });
  await tabTo(page, cluster);
  const clusterBounds = (await cluster.boundingBox())!;
  expect(clusterBounds.width).toBeGreaterThanOrEqual(44);
  expect(clusterBounds.height).toBeGreaterThanOrEqual(44);
  await expect(cluster).toHaveCSS('outline-style', 'solid');
  await expect(cluster).toHaveCSS('outline-width', '3px');
  await page.keyboard.press('Enter');
  const overlap = page.getByRole('button', { name: '查看此处的 2 篇文章' });
  await overlap.click();
  const close = page.getByRole('button', { name: '关闭文章面板' });
  const closeBounds = (await close.boundingBox())!;
  expect(closeBounds.width).toBeGreaterThanOrEqual(44);
  expect(closeBounds.height).toBeGreaterThanOrEqual(44);

  await page.goto('/blog/posts/route/');
  const canvas = page.locator('[data-hpm-canvas]');
  await tabTo(page, canvas);
  await expect(canvas).toHaveCSS('outline-style', 'solid');
  await expect(canvas).toHaveCSS('outline-width', '3px');
});

test('the article panel remains opaque when backdrop filters are unavailable', async ({ page }) => {
  await page.goto('/blog/map/');
  await page.getByRole('button', { name: '查看此处的 4 篇文章' }).click();
  await page.getByRole('button', { name: '查看此处的 2 篇文章' }).click();
  const panel = page.getByRole('dialog', { name: '2 篇文章' });
  await page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      for (let index = sheet.cssRules.length - 1; index >= 0; index--) {
        const rule = sheet.cssRules[index];
        if (rule instanceof CSSSupportsRule && rule.conditionText.includes('backdrop-filter'))
          sheet.deleteRule(index);
      }
    }
  });
  const fallback = await panel.evaluate((element) => {
    const style = getComputedStyle(element);
    const parse = (value: string) =>
      (value.match(/[\d.]+/gu) ?? []).map((component) => Number(component));
    const [red = 0, green = 0, blue = 0, alpha = 1] = parse(style.backgroundColor);
    const [textRed = 0, textGreen = 0, textBlue = 0] = parse(style.color);
    const luminance = (components: number[]) => {
      const [r, g, b] = components.map((component) => {
        const channel = component / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const surface = luminance([red, green, blue]);
    const text = luminance([textRed, textGreen, textBlue]);
    return {
      alpha,
      contrast: (Math.max(surface, text) + 0.05) / (Math.min(surface, text) + 0.05),
    };
  });
  expect(fallback.alpha).toBe(1);
  expect(fallback.contrast).toBeGreaterThanOrEqual(4.5);
});

test('article dates and locations meet normal-text contrast against their cards', async ({
  page,
}) => {
  await page.goto('/blog/map/');
  await page.getByRole('button', { name: '查看此处的 4 篇文章' }).click();
  await page.getByRole('button', { name: '查看此处的 2 篇文章' }).click();
  const metadataContrast = await page
    .getByRole('dialog', { name: '2 篇文章' })
    .locator('.hpm-post__link')
    .first()
    .evaluate((card) => {
      const parse = (value: string) =>
        (value.match(/[\d.]+/gu) ?? []).slice(0, 3).map((component) => Number(component));
      const luminance = (components: number[]) => {
        const [red, green, blue] = components.map((component) => {
          const channel = component / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
      };
      const surface = luminance(parse(getComputedStyle(card).backgroundColor));
      return Array.from(card.querySelectorAll('.hpm-post__date, .hpm-post__location')).map(
        (element) => {
          const text = luminance(parse(getComputedStyle(element).color));
          return (Math.max(surface, text) + 0.05) / (Math.min(surface, text) + 0.05);
        },
      );
    });
  expect(metadataContrast).toHaveLength(2);
  for (const ratio of metadataContrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
});
