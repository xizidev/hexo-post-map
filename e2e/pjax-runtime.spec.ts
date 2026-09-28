import type { Page, Route } from 'playwright/test';
import { test, expect } from './fixtures';

async function replaceHostFrom(page: Page, path: string) {
  await page.evaluate(async (path) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`PJAX document failed: ${response.status}`);
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    const root = parsed.querySelector('[data-hpm-detail], [data-hpm-overview]');
    if (!root) throw new Error(`PJAX map root missing: ${path}`);
    let host = document.querySelector('#pjax-test-host');
    if (!host) {
      host = document.createElement('main');
      host.id = 'pjax-test-host';
      document.body.append(host);
    }
    // Import only the SSR root and its inert JSON; never execute destination scripts.
    host.replaceChildren(document.importNode(root, true));
  }, path);
}

async function clearHost(page: Page) {
  await page.locator('#pjax-test-host').evaluate((host) => host.replaceChildren());
}

test('ordinary -> detail -> detail -> overview -> ordinary uses one lazy runtime', async ({
  page,
  network,
}) => {
  await page.goto('/blog/posts/plain/');
  expect(network.local['/blog/hexo-post-map/assets/runtime.js']).toBe(1);
  expect(network.local['/blog/hexo-post-map/assets/style.css'] ?? 0).toBe(0);
  await replaceHostFrom(page, '/blog/posts/single/');
  await expect(page.locator('[data-hpm-detail]')).toHaveAttribute('data-hpm-active', 'true');
  await replaceHostFrom(page, '/blog/posts/route/');
  await expect(page.locator('[data-hpm-detail]')).toHaveAttribute('data-hpm-active', 'true');
  await expect(page.locator('.hpm-detail-marker')).toHaveCount(3);
  await replaceHostFrom(page, '/blog/map/');
  await expect(page.locator('[data-hpm-overview]')).toHaveAttribute('data-hpm-active', 'true');
  await clearHost(page);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__hpmSdk').destroyedMaps))
    .toBe(3);
  for (const asset of ['runtime.js', 'style.css', 'post-map.js', 'overview-map.js'])
    expect(network.local[`/blog/hexo-post-map/assets/${asset}`]).toBe(1);
  expect(network.local['/blog/map/posts.json']).toBe(1);
  expect(network.sdkRequests).toBe(1);
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps.length)).toBe(3);
  await expect(
    page.locator(
      '[data-hpm-active="true"], .hpm-detail-marker, .hpm-image-marker, .hpm-cluster, .hpm-panel',
    ),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/\/blog\/posts\/plain\/$/);
});

test('manual refresh initializes an inserted root without MutationObserver', async ({ page }) => {
  await page.addInitScript(() => Reflect.set(window, 'MutationObserver', undefined));
  await page.goto('/blog/posts/plain/');
  await replaceHostFrom(page, '/blog/posts/single/');
  await expect(page.locator('[data-hpm-detail]')).not.toHaveAttribute('data-hpm-active', 'true');
  await page
    .locator('[data-hpm-detail]')
    .evaluate((root) => Reflect.get(window, 'HexoPostMap').refresh(root));
  await expect(page.locator('[data-hpm-detail]')).toHaveAttribute('data-hpm-active', 'true');
  await expect(page.locator('.hpm-detail-marker')).toHaveCount(1);
});

test('late posts.json cannot revive an overview root removed during navigation', async ({
  page,
  network,
}) => {
  // Let the real fetch resolve after teardown even though the controller aborts its signal.
  // This exercises the stale-result guard, not merely browser cancellation.
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    Reflect.set(window, '__hpmLateResponses', 0);
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== '/blog/map/posts.json') return original(input, init);
      const response = await original(input, { ...init, signal: undefined });
      Reflect.set(window, '__hpmLateResponses', Reflect.get(window, '__hpmLateResponses') + 1);
      return response;
    };
  });
  let delayed: Route | undefined;
  await page.route('**/blog/map/posts.json', (route) => {
    delayed = route;
  });
  try {
    await page.goto('/blog/posts/plain/');
    await replaceHostFrom(page, '/blog/posts/single/');
    await expect(page.locator('[data-hpm-detail]')).toHaveAttribute('data-hpm-active', 'true');
    await replaceHostFrom(page, '/blog/map/');
    await expect.poll(() => Boolean(delayed)).toBe(true);
    const removed = await page.locator('[data-hpm-overview]').elementHandle();
    expect(removed).not.toBeNull();
    await clearHost(page);
    await expect.poll(() => removed!.getAttribute('data-hpm-active')).toBe('false');
    const snapshot = () =>
      page.evaluate(() => ({
        maps: Reflect.get(window, '__hpmSdk').maps.length,
        destroyed: Reflect.get(window, '__hpmSdk').destroyedMaps,
        markers: Reflect.get(window, '__hpmSdk').markers.length,
        visibleMarkers: document.querySelectorAll(
          '.hpm-detail-marker, .hpm-image-marker, .hpm-cluster',
        ).length,
        panels: document.querySelectorAll('.hpm-panel').length,
        active: document.querySelectorAll('[data-hpm-active="true"]').length,
      }));
    const before = await snapshot();
    expect(before).toEqual({
      maps: 1,
      destroyed: 1,
      markers: 1,
      visibleMarkers: 0,
      panels: 0,
      active: 0,
    });
    const response = await delayed!.fetch();
    await delayed!.fulfill({ response });
    delayed = undefined;
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__hpmLateResponses'))).toBe(1);
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    expect(await snapshot()).toEqual(before);
    expect(
      await removed!.evaluate((root) => ({
        connected: root.isConnected,
        active: root.getAttribute('data-hpm-active'),
        interactive: root.querySelectorAll(
          '.hpm-panel, .hpm-image-marker, .hpm-cluster, [data-hpm-show-list]',
        ).length,
      })),
    ).toEqual({ connected: false, active: 'false', interactive: 0 });
    expect(network.sdkRequests).toBe(1);
    await removed!.dispose();
  } finally {
    if (delayed) await delayed.abort();
    await page.unroute('**/blog/map/posts.json');
  }
});

test('versioned manual API is immutable and rejects invalid scopes in the browser', async ({
  page,
}) => {
  await page.goto('/blog/posts/plain/');
  expect(
    await page.evaluate(() => {
      const api = Reflect.get(window, 'HexoPostMap');
      const descriptor = Object.getOwnPropertyDescriptor(window, 'HexoPostMap')!;
      const foreign = document.implementation.createHTMLDocument();
      const errors = [];
      for (const method of ['refresh', 'destroy']) {
        for (const input of [null, {}, document.createTextNode('x'), foreign, foreign.body]) {
          try {
            api[method](input);
            errors.push(false);
          } catch (error) {
            errors.push(error instanceof TypeError);
          }
        }
      }
      return {
        version: api.apiVersion,
        frozen: Object.isFrozen(api),
        enumerable: descriptor.enumerable,
        writable: descriptor.writable,
        configurable: descriptor.configurable,
        errors,
      };
    }),
  ).toEqual({
    version: 1,
    frozen: true,
    enumerable: false,
    writable: false,
    configurable: false,
    errors: Array(10).fill(true),
  });
});

test('no-JS detail keeps its static place list and 220px canvas without executing features', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  const requests: string[] = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    if (url.origin === 'http://127.0.0.1:4179') await route.continue();
    else await route.abort();
  });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4179/blog/posts/single/');
    await expect(page.locator('link[href="/blog/hexo-post-map/assets/style.css"]')).toHaveCount(1);
    await expect(page.locator('[data-hpm-fallback]')).toBeVisible();
    await expect(page.locator('[data-hpm-fallback] a')).toHaveCount(1);
    await expect(page.locator('[data-hpm-canvas]')).toHaveCSS('height', '220px');
    await expect(
      page.locator(
        '[data-hpm-active="true"], .hpm-detail-marker, script[src$="post-map.js"], script[src$="overview-map.js"]',
      ),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        runtime: Reflect.has(window, 'HexoPostMap'),
        sdk: Reflect.has(window, '__hpmSdk'),
      })),
    ).toEqual({ runtime: false, sdk: false });
    expect(requests.filter((path) => /\/(post-map|overview-map)\.js$|\/maps$/.test(path))).toEqual(
      [],
    );
  } finally {
    await context.close();
  }
});
