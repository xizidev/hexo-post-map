import { test, expect } from './fixtures';

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
  await expect(pin).toBeEmpty();
  await expect(pin).toHaveAttribute('aria-hidden', 'true');
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
  await expect(
    root.locator('[data-hpm-canvas] button, [data-hpm-canvas] a, .hpm-place-card'),
  ).toHaveCount(0);
  await expect(root).toHaveAttribute('data-hpm-active', 'true');
});

test('route draws ordered coordinates and silent numbered pins with accessible map names', async ({
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
  await expect(pins).toHaveText(['1', '2', '3']);
  await expect(pins.locator('.hpm-detail-marker__label')).toHaveText(['1', '2', '3']);
  // Bottom-anchored rotated pins extend above their coordinates. The SDK fit
  // must reserve their full painted height, plus a small gap, above the bounds.
  expect(
    await page.evaluate(() => {
      const padding = Reflect.get(window, '__hpmSdk').maps[0].fitPadding;
      const height = Math.max(
        ...Array.from(document.querySelectorAll('.hpm-detail-marker')).map(
          (pin) => pin.getBoundingClientRect().height,
        ),
      );
      return padding[0] >= Math.ceil(height) + 4;
    }),
  ).toBe(true);
  await expect(page.locator('[data-hpm-canvas]')).toHaveAttribute(
    'aria-label',
    '文章地点地图：Summit GCJ-02、Visitor center GCJ-02、Cableway GCJ-02',
  );
  await expect(
    page.locator('[data-hpm-canvas] button, [data-hpm-canvas] a, .hpm-place-card'),
  ).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').paths)).toEqual([
    [
      [114.1501, 27.4682],
      [114.1623, 27.4741],
      [114.1735, 27.4568],
    ],
  ]);
});

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
  await expect(pins).toHaveText(['', '']);
  await expect(pins.locator('.hpm-detail-marker__label')).toHaveCount(0);
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
