import type { Locator, Page } from 'playwright/test';
import {
  expect,
  fireAnimationFrame,
  installControlledAnimationFrames,
  installOverviewExplorationFixture,
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

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 320, height: 480 },
]) {
  for (const mode of ['all', 'single'] as const) {
    for (const forced of [false, true]) {
      test(`manual sharing is visible and operable with an open ${mode} panel at ${viewport.width}x${viewport.height} ${forced ? 'forced colors' : 'normal colors'}`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({
          forcedColors: forced ? 'active' : 'none',
          reducedMotion: 'reduce',
        });
        await installOverviewExplorationFixture(page, {
          count: 30,
          flags: { restore: true, share: true, random: true },
        });
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'clipboard', { value: undefined });
          Math.random = () => 0;
        });
        await page.goto('/blog/map/');
        await page.getByRole('button', { name: mode === 'all' ? /^全部文章/ : '随机一站' }).click();
        const panel = page.getByRole('dialog');
        await expect(panel).toBeVisible();
        const preview = await panel.elementHandle();
        const canvas = page.locator('[data-hpm-canvas]');
        const before = (await canvas.boundingBox())!;
        const share = page.getByRole('button', { name: '分享地图' });
        await share.click();
        const input = page.getByRole('textbox', { name: '地图分享链接（请手动复制）' });
        await expect(input).toBeFocused();
        if (process.env.HPM_CAPTURE_OVERVIEW === '1')
          await page.screenshot({
            path: `.superpowers/sdd/2026-10-08-overview-exploration/output/playwright/manual-open-${viewport.width}-${viewport.height}-${mode}${forced ? '-forced' : ''}.png`,
          });
        // Native visibility requires the whole input and close target to survive stacking,
        // not only CSS visibility or programmatic focus behind another surface.
        for (const target of [input, page.locator('[data-hpm-share-close]')]) {
          const bounds = (await target.boundingBox())!;
          expect(bounds.width).toBeGreaterThanOrEqual(44);
          expect(bounds.height).toBeGreaterThanOrEqual(44);
          expect(
            await target.evaluate((node) => {
              const box = node.getBoundingClientRect();
              return [
                [box.left + 2, box.top + 2],
                [box.right - 2, box.top + 2],
                [box.left + 2, box.bottom - 2],
                [box.right - 2, box.bottom - 2],
                [box.x + box.width / 2, box.y + box.height / 2],
              ].every(([x, y]) => node.contains(document.elementFromPoint(x!, y!)));
            }),
          ).toBe(true);
        }
        await input.click();
        await expect(input).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('[data-hpm-share-close]')).toBeFocused();
        await page.locator('[data-hpm-share-close]').click();
        await expect(input).toHaveCount(0);
        await expect(share).toBeFocused();
        await expect(panel).toBeVisible();
        expect(
          await preview!.evaluate((node) => node === document.querySelector('.hpm-panel')),
        ).toBe(true);
        const after = (await canvas.boundingBox())!;
        for (const key of ['x', 'y', 'width', 'height'] as const)
          expect(Math.abs(after[key] - before[key]), key).toBeLessThanOrEqual(1);
        const panelClose = page.getByRole('button', { name: '关闭文章面板' });
        // Circular close targets have intentionally empty corner pixels: check the center.
        expect(
          await panelClose.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return node.contains(
              document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
            );
          }),
        ).toBe(true);
        await panelClose.click();
        await expect(panel).toHaveCount(0);
        await preview!.dispose();
      });
    }
  }
}

for (const mobile of [false, true]) {
  test(`exploration targets and manual copy remain usable with forced colors on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await installOverviewExplorationFixture(page, {
      count: 30,
      flags: { restore: true, share: true, random: true },
    });
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'clipboard', { value: undefined }),
    );
    await page.goto('/blog/map/');
    const share = page.getByRole('button', { name: '分享地图' });
    await tabTo(page, share);
    await expect(share).toHaveCSS('outline-width', '3px');
    const folder = '.superpowers/sdd/2026-10-08-overview-exploration/output/playwright';
    if (process.env.HPM_CAPTURE_OVERVIEW === '1')
      await page.screenshot({ path: `${folder}/${mobile ? 'mobile' : 'desktop'}-overview.png` });
    await page.keyboard.press('Enter');
    const input = page.getByRole('textbox', { name: '地图分享链接（请手动复制）' });
    await expect(input).toBeFocused();
    if (process.env.HPM_CAPTURE_OVERVIEW === '1')
      await page.screenshot({ path: `${folder}/${mobile ? 'mobile' : 'desktop'}-manual.png` });
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    for (const selector of [
      '[data-hpm-show-list]',
      '[data-hpm-share]',
      '[data-hpm-random]',
      '[data-hpm-share-close]',
      '[data-hpm-share-manual] input',
    ]) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.width, selector).toBeGreaterThanOrEqual(44);
      expect(box.height, selector).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    if (process.env.HPM_CAPTURE_OVERVIEW === '1')
      await page.screenshot({
        path: `${folder}/${mobile ? 'mobile' : 'desktop'}-manual-forced-colors.png`,
      });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^全部文章/ }).click();
    const close = page.getByRole('button', { name: '关闭文章面板' });
    await expect(close).toBeFocused();
    if (process.env.HPM_CAPTURE_OVERVIEW === '1')
      await page.screenshot({
        path: `${folder}/${mobile ? 'mobile' : 'desktop'}-panel-forced-colors.png`,
      });
    const closeBox = (await close.boundingBox())!;
    expect(closeBox.width).toBeGreaterThanOrEqual(44);
    expect(closeBox.height).toBeGreaterThanOrEqual(44);
    // Check hit testing, which catches an overlapping toolbar even when boxes are large.
    expect(
      await close.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return node.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        );
      }),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^全部文章/ })).toBeFocused();
    // A deterministic SDK does not render vendor attribution; reserve its actual corner footprint.
    const toolbar = (await page.locator('[data-hpm-toolbar]').boundingBox())!;
    const canvas = (await page.locator('[data-hpm-canvas]').boundingBox())!;
    expect(toolbar.y + toolbar.height).toBeLessThan(canvas.y + canvas.height - 20);
  });
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
