import { test, expect } from './fixtures';

test('detail stays unloaded offscreen and activates with keyboard without trapping reading scroll', async ({
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
  await expect(root.locator('[data-hpm-activate]')).toBeDisabled();
  expect(network.sdkRequests).toBe(0);
  await expect(root.locator('[data-hpm-fallback]')).toBeVisible();
  await root.scrollIntoViewIfNeeded();
  const activate = root.locator('[data-hpm-activate]');
  await expect(activate).toBeEnabled();
  expect(network.sdkRequests).toBe(1);
  await expect(root.locator('[data-hpm-canvas]')).toHaveCSS('pointer-events', 'none');
  await activate.focus();
  await page.keyboard.press('Enter');
  await expect(root).toHaveAttribute('data-hpm-active', 'true');
  await expect(root.locator('[data-hpm-canvas]')).toBeFocused();
  await root.getByRole('button', { name: 'Shanghai GCJ-02', exact: true }).click();
  await expect(root.getByRole('link', { name: '在高德地图中查看' })).toHaveAttribute(
    'href',
    /coordinate=gaode/,
  );
  await page.keyboard.press('Escape');
  await expect(activate).toBeFocused();
  await expect(root).toHaveAttribute('data-hpm-active', 'false');
});

test('route draws ordered coordinates and numbered accessible markers', async ({ page }) => {
  await page.goto('/blog/posts/route/');
  await page.locator('[data-hpm-activate]').click();
  await expect(page.getByRole('button', { name: 'Visitor center GCJ-02' })).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Cableway GCJ-02' })).toHaveText('2');
  await expect(page.getByRole('button', { name: 'Summit GCJ-02' })).toHaveText('3');
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').paths)).toEqual([
    [
      [114.1501, 27.4682],
      [114.1623, 27.4741],
      [114.1735, 27.4568],
    ],
  ]);
});

test('multi-point article fits its points without inventing a route', async ({ page }) => {
  await page.goto('/blog/posts/multi/');
  await expect(page.locator('[data-hpm-activate]')).toBeEnabled();
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
  await expect(page.locator('[data-hpm-activate]')).toHaveCount(2);
  await expect(page.locator('[data-hpm-activate]').nth(0)).toBeEnabled();
  await expect(page.locator('[data-hpm-activate]').nth(1)).toBeEnabled();
  expect(network.sdkRequests).toBe(1);
});
