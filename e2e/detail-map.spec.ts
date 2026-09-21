import type { Locator, Page } from 'playwright/test';
import { test, expect } from './fixtures';

async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let press = 0; press < 30; press++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  await expect(target).toBeFocused();
}

test('detail stays unloaded offscreen and becomes interactive automatically near the viewport', async ({
  page,
  network,
}) => {
  await page.addInitScript(() =>
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        const root = document.querySelector<HTMLElement>('[data-hpm-detail]');
        if (root) root.style.marginTop = '200vh';
      },
      { once: true },
    ),
  );
  await page.goto('/blog/posts/single/');
  const root = page.locator('[data-hpm-detail]');
  await expect(root.locator('[data-hpm-activate]')).toHaveCount(0);
  expect(network.sdkRequests).toBe(0);
  await expect(root.locator('[data-hpm-fallback]')).toBeVisible();
  await root.scrollIntoViewIfNeeded();
  const pin = root.locator('.hpm-detail-marker');
  await expect(pin).toBeVisible();
  await expect(pin.locator('svg')).toHaveAttribute('viewBox', '0 0 30 38');
  await expect(pin.locator('.hpm-detail-marker__shape')).toHaveCount(1);
  await expect(pin.locator('.hpm-detail-marker__dot')).toHaveCount(1);
  await expect(pin.locator('.hpm-detail-marker__label')).toHaveCount(0);
  await expect(pin).toHaveAttribute('aria-label', '显示地点：Shanghai GCJ-02');
  await expect(pin).toHaveAttribute('aria-expanded', 'false');
  await expect(root.locator('[data-hpm-canvas]')).toHaveAttribute(
    'aria-label',
    '文章地点地图：Shanghai GCJ-02',
  );
  expect(network.sdkRequests).toBe(1);
  await expect(root.locator('[data-hpm-canvas]')).toHaveCSS('pointer-events', 'auto');
  await expect(root).toHaveAttribute('data-hpm-active', 'true');
  await expect(root.locator('[data-hpm-status]')).toBeEmpty();
  await expect(root.locator('[data-hpm-fallback]')).toBeHidden();
  await pin.click();
  const tooltip = root.getByRole('tooltip');
  await expect(tooltip).toHaveText('Shanghai GCJ-02');
  await expect(tooltip).toBeVisible();
  await expect(pin).toHaveAttribute('aria-expanded', 'true');
  const tooltipId = await tooltip.getAttribute('id');
  expect(tooltipId).not.toBeNull();
  await expect(pin).toHaveAttribute('aria-describedby', tooltipId!);
  await expect(
    root.locator('[data-hpm-canvas] .amap-info-window, [data-hpm-canvas] a'),
  ).toHaveCount(0);
  await pin.click();
  await expect(tooltip).toBeHidden();
  await expect(pin).toHaveAttribute('aria-expanded', 'false');
  await expect(pin).not.toHaveAttribute('aria-describedby', /.+/u);
  await expect(root).toHaveAttribute('data-hpm-active', 'true');
});

test('route draws ordered coordinates and interactive numbered pins with accessible map names', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/blog/posts/route/');
  expect(
    await page.locator('[data-hpm-detail]').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        route: style.getPropertyValue('--hpm-route-color').trim(),
        text: style.getPropertyValue('--hpm-text').trim(),
        muted: style.getPropertyValue('--hpm-muted').trim(),
      };
    }),
  ).toEqual({ route: '#5eead4', text: '#e2e8f0', muted: '#94a3b8' });
  const pins = page.locator('.hpm-detail-marker');
  await expect(pins.locator('.hpm-detail-marker__label')).toHaveText(['1', '2', '3']);
  await expect(pins.locator('.hpm-detail-marker__shape')).toHaveCount(3);
  await expect(pins.locator('.hpm-detail-marker__dot')).toHaveCount(0);
  expect(
    await pins.evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        const svg = element.querySelector('svg')!.getBoundingClientRect();
        return {
          marker: [bounds.width, bounds.height],
          icon: [svg.width, svg.height],
        };
      }),
    ),
  ).toEqual([
    { marker: [44, 44], icon: [30, 38] },
    { marker: [44, 44], icon: [30, 38] },
    { marker: [44, 44], icon: [30, 38] },
  ]);
  // Bottom-anchored pins extend above their coordinates. The SDK fit
  // must reserve their full painted height, plus a small gap, above the bounds.
  expect(
    await page.evaluate(() => {
      const padding = Reflect.get(window, '__hpmSdk').maps[0].fitPadding;
      const height = Math.max(
        ...Array.from(document.querySelectorAll('.hpm-detail-marker')).map(
          (pin) => pin.getBoundingClientRect().height,
        ),
      );
      return padding[0] >= Math.ceil(height) + 64;
    }),
  ).toBe(true);
  await expect(page.locator('[data-hpm-canvas]')).toHaveAttribute(
    'aria-label',
    '文章地点地图：Summit GCJ-02、Visitor center GCJ-02、Cableway GCJ-02',
  );
  await expect(page.locator('[data-hpm-canvas] button')).toHaveCount(3);
  await expect(page.locator('[data-hpm-canvas] a, .amap-info-window')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').paths)).toEqual([
    [
      [114.1501, 27.4682],
      [114.1623, 27.4741],
      [114.1735, 27.4568],
    ],
  ]);
});

test('route place tooltips switch across mouse and keyboard and close without losing focus', async ({
  page,
}) => {
  await page.goto('/blog/posts/route/');
  const canvas = page.locator('[data-hpm-canvas]');
  const pins = page.locator('.hpm-detail-marker');
  const first = pins.nth(0);
  const second = pins.nth(1);

  await first.click();
  await expect(first.getByRole('tooltip')).toHaveText('1 · Visitor center GCJ-02');
  await expect(first.getByRole('tooltip')).toBeVisible();
  await expect(first).toHaveAttribute('aria-expanded', 'true');

  await tabTo(page, second);
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(second).toHaveAttribute('aria-expanded', 'true');
  await expect(second.getByRole('tooltip')).toHaveText('2 · Cableway GCJ-02');
  await expect(second.getByRole('tooltip')).toBeVisible();
  const secondTooltipId = await second.getByRole('tooltip').getAttribute('id');
  expect(secondTooltipId).not.toBeNull();
  await expect(second).toHaveAttribute('aria-describedby', secondTooltipId!);

  await page.keyboard.press('Escape');
  await expect(second).toHaveAttribute('aria-expanded', 'false');
  await expect(second).toBeFocused();
  await page.keyboard.press('Space');
  await expect(second).toHaveAttribute('aria-expanded', 'true');
  await canvas.click({ position: { x: 12, y: 12 } });
  await expect(second).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.amap-info-window, [data-hpm-canvas] a')).toHaveCount(0);
});

test('place tooltip keeps readable contrast when a host theme overrides map text', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/blog/posts/single/');
  const root = page.locator('[data-hpm-detail]');
  await root.evaluate((element) =>
    (element as HTMLElement).style.setProperty('--hpm-text', '#c9cacc'),
  );
  await root.locator('.hpm-detail-marker').click();
  const contrast = await root.getByRole('tooltip').evaluate((element) => {
    const parse = (value: string) =>
      (value.match(/[\d.]+/gu) ?? []).map((component) => Number(component));
    const luminance = ([red, green, blue]: number[]) => {
      const channels = [red, green, blue].map((component = 0) => {
        const channel = component / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    };
    const style = getComputedStyle(element);
    const foreground = luminance(parse(style.color));
    const background = luminance(parse(style.backgroundColor));
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 900 },
]) {
  test(`long place tooltip stays inside the detail canvas at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.route('**/posts/route/', async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        /(<script type="application\/json" data-hpm-data>)([\s\S]*?)(<\/script>)/u,
        (_all, start, json, end) => {
          const data = JSON.parse(json);
          data.map.points[0].name =
            'A deliberately long place name that must wrap without leaving the visible map canvas';
          data.map.route[0].name = data.map.points[0].name;
          return start + JSON.stringify(data).replaceAll('<', '\\u003c') + end;
        },
      );
      await route.fulfill({ response, body });
    });
    await page.goto('/blog/posts/route/');
    await page.locator('.hpm-detail-marker').first().click();
    const canvas = page.locator('[data-hpm-canvas]');
    const tooltip = page.getByRole('tooltip', { name: /A deliberately long place name/u });
    await expect(tooltip).toBeVisible();
    const [canvasBox, tooltipBox] = await Promise.all([
      canvas.boundingBox(),
      tooltip.boundingBox(),
    ]);
    expect(tooltipBox!.x).toBeGreaterThanOrEqual(canvasBox!.x);
    expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(canvasBox!.x + canvasBox!.width);
    expect(tooltipBox!.y).toBeGreaterThanOrEqual(canvasBox!.y);
    expect(tooltipBox!.y + tooltipBox!.height).toBeLessThanOrEqual(
      canvasBox!.y + canvasBox!.height,
    );
  });
}

test('out-and-back route retains each visit label and its return segment', async ({ page }) => {
  await page.route('**/posts/route/', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /(<script type="application\/json" data-hpm-data>)([\s\S]*?)(<\/script>)/u,
      (_all, start, json, end) => {
        const data = JSON.parse(json);
        data.map.route = [data.map.points[0], data.map.points[1], data.map.points[0]];
        return start + JSON.stringify(data).replaceAll('<', '\\u003c') + end;
      },
    );
    await route.fulfill({ response, body });
  });
  await page.goto('/blog/posts/route/');
  await expect(page.locator('.hpm-detail-marker__label')).toHaveText(['1', '2', '3']);
  await expect(page.locator('.hpm-detail-marker')).toHaveCount(4);
  const path = await page.evaluate(() => Reflect.get(window, '__hpmSdk').paths[0]);
  expect(path).toHaveLength(3);
  expect(path[0]).toEqual(path[2]);
  expect(path[0]).not.toEqual(path[1]);
});

test('multi-point article fits its points without inventing a route', async ({ page }) => {
  await page.goto('/blog/posts/multi/');
  await expect(page.locator('[data-hpm-detail]')).toHaveAttribute('data-hpm-active', 'true');
  const pins = page.locator('.hpm-detail-marker');
  await expect(pins.locator('.hpm-detail-marker__label')).toHaveCount(0);
  await expect(pins.locator('.hpm-detail-marker__dot')).toHaveCount(2);
  expect(
    await page.evaluate(() => ({
      paths: Reflect.get(window, '__hpmSdk').paths,
      fitted: Reflect.get(window, '__hpmSdk').maps[0].fitted,
    })),
  ).toEqual({ paths: [], fitted: true });
});

test('SDK failure keeps place links and article readable', async ({ page }) => {
  await page.route('https://webapi.amap.com/**', (route) => route.abort());
  await page.goto('/blog/posts/single/');
  await expect(page.locator('[data-hpm-status]')).toContainText('无法加载');
  await expect(page.locator('[data-hpm-fallback]')).toBeVisible();
  await expect(page.locator('[data-hpm-fallback] a')).toContainText('Shanghai GCJ-02');
  await expect(page.getByText('Single-point article content.')).toBeVisible();
});

test('multiple detail maps reuse one SDK load and ordinary pages request none', async ({
  page,
  network,
}) => {
  await page.goto('/blog/posts/plain/');
  expect(network.sdkRequests).toBe(0);
  await expect(page.locator('[data-hpm-detail], script[src*="hexo-post-map"]')).toHaveCount(0);
  await page.route('**/posts/single/', async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    // Supply two server-rendered components before the published bundle hydrates them.
    const component = html.match(/<section class="hpm-detail"[\s\S]*?<\/section>/u)?.[0];
    expect(component).toBeTruthy();
    await route.fulfill({ response, body: html.replace(component!, component! + component!) });
  });
  await page.goto('/blog/posts/single/');
  await expect(page.locator('[data-hpm-activate]')).toHaveCount(0);
  await expect(page.locator('.hpm-detail-marker')).toHaveCount(2);
  await expect(page.locator('[data-hpm-detail][data-hpm-active="true"]')).toHaveCount(2);
  expect(network.sdkRequests).toBe(1);
});
