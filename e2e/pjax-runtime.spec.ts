import type { Page, Route } from 'playwright/test';
import {
  expect,
  fireAnimationFrame,
  fireCancelledAnimationFrames,
  installControlledAnimationFrames,
  installOverviewExplorationFixture,
  installTrackedPage,
  pendingAnimationFrames,
  test,
  TRACK_ASSET_BODY,
  TRACK_ASSET_PATH,
} from './fixtures';

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

test('ordinary-page query is ignored and PJAX return restores the latest panel', async ({
  page,
  network,
}) => {
  await installOverviewExplorationFixture(page, {
    count: 30,
    flags: { restore: true, share: true, random: true },
  });
  await page.goto(
    '/blog/posts/plain/?hpm_v=1&hpm_center=121,31&hpm_zoom=12&hpm_post=javascript:alert(1)',
  );
  await replaceHostFrom(page, '/blog/map/');
  await expect(page.getByRole('button', { name: '分享地图' })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].getZoom())).toBe(4);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() =>
    Reflect.get(window, '__hpmSdk').maps[0].setZoomAndCenter(10, [118, 32], true),
  );
  await page.getByRole('button', { name: /^全部文章/ }).evaluate((button) => {
    button.addEventListener(
      'click',
      () => Reflect.set(window, '__panelOpenedAt', performance.now()),
      { once: true },
    );
  });
  await page.getByRole('button', { name: /^全部文章/ }).click();
  const receipt = await page.locator('.hpm-panel__scroller').evaluate(
    (node) =>
      new Promise<{ trusted: boolean; scrollDelay: number; sinceOpen: number; top: number }>(
        (resolve) => {
          const started = performance.now();
          node.addEventListener(
            'scroll',
            (event) => {
              // Register after the controller: its native scroll listener receives the position first.
              const received = performance.now();
              const top = node.scrollTop;
              document.querySelector('#pjax-test-host')!.replaceChildren();
              resolve({
                trusted: event.isTrusted,
                scrollDelay: received - started,
                sinceOpen: received - Reflect.get(window, '__panelOpenedAt'),
                top,
              });
            },
            { once: true },
          );
          node.scrollTop = 400;
        },
      ),
  );
  expect(receipt.trusted).toBe(true);
  expect(receipt.top).toBe(400);
  expect(receipt.scrollDelay).toBeLessThan(200);
  expect(receipt.sinceOpen).toBeLessThan(200);
  console.info(`PJAX native scroll receipt/removal: ${JSON.stringify(receipt)}`);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__hpmSdk').destroyedMaps))
    .toBe(1);
  await replaceHostFrom(page, '/blog/map/');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect
    .poll(() => page.locator('.hpm-panel__scroller').evaluate((node) => node.scrollTop))
    .toBe(400);
  await expect(page.getByRole('button', { name: '关闭文章面板' })).not.toBeFocused();
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps.at(-1).getZoom())).toBe(10);
  const before = await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps.length);
  await page.evaluate(() => {
    // Simulate a theme's URL-only transition; unchanged roots are not a routing API.
    history.replaceState({ theme: true }, '', '/blog/map/?hpm_v=1&hpm_center=121,31&hpm_zoom=15');
    Reflect.get(window, 'HexoPostMap').refresh();
  });
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps.length)).toBe(before);
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps.at(-1).getZoom())).toBe(10);
  expect(
    Object.keys(network.local).filter(
      (path) => path.includes('/tracks/') || /\.(gpx|geojson)$/u.test(path),
    ),
  ).toEqual([]);
});

async function observeTrackAbortWithoutCancellingTransport(page: Page) {
  await page.addInitScript((trackPath) => {
    const original = window.fetch.bind(window);
    Reflect.set(window, '__hpmTrackAborts', 0);
    Reflect.set(window, '__hpmLateTrackResponses', 0);
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== trackPath) return original(input, init);
      init?.signal?.addEventListener(
        'abort',
        () => Reflect.set(window, '__hpmTrackAborts', Reflect.get(window, '__hpmTrackAborts') + 1),
        { once: true },
      );
      const response = await original(input, { ...init, signal: undefined });
      Reflect.set(
        window,
        '__hpmLateTrackResponses',
        Reflect.get(window, '__hpmLateTrackResponses') + 1,
      );
      return response;
    };
  }, TRACK_ASSET_PATH);
}

async function delayTrackConversions(page: Page) {
  await page.addInitScript(() => {
    type ConvertCallback = (status: string, result?: unknown) => void;
    type ConvertFrom = (
      batch: readonly (readonly number[])[],
      source: string,
      callback: ConvertCallback,
    ) => void;
    type AMapApi = { convertFrom: ConvertFrom };
    type FakeSdk = {
      pendingConversions: Array<() => void>;
      releaseAllConversions: () => void;
    };
    let amap: AMapApi | undefined;
    Object.defineProperty(window, 'AMap', {
      configurable: true,
      get: () => amap,
      set(value: AMapApi) {
        const original = value.convertFrom.bind(value);
        const pending: Array<() => void> = [];
        value.convertFrom = (batch, source, callback) => {
          pending.push(() => original(batch, source, callback));
        };
        const sdk = Reflect.get(window, '__hpmSdk') as FakeSdk;
        sdk.pendingConversions = pending;
        sdk.releaseAllConversions = () => {
          while (pending.length > 0) pending.shift()!();
        };
        amap = value;
      },
    });
  });
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

test('initial static stylesheet success is adopted without another request', async ({
  page,
  network,
}) => {
  await page.goto('/blog/posts/single/');
  await expect(page.locator('[data-hpm-detail]')).toHaveAttribute('data-hpm-active', 'true');
  await expect(page.locator('[data-hpm-canvas]')).toHaveCSS('height', '220px');
  expect(network.local['/blog/hexo-post-map/assets/style.css']).toBe(1);
  expect(network.local['/blog/hexo-post-map/assets/post-map.js']).toBe(1);
});

for (const failure of ['404', 'network'] as const) {
  test(`initial static stylesheet ${failure} before deferred runtime retries once on scoped refresh`, async ({
    page,
    network,
  }) => {
    const stylePath = '/blog/hexo-post-map/assets/style.css';
    let repaired = false;
    let deferredRuntime: Route | undefined;
    await page.addInitScript(() => {
      document.addEventListener(
        'error',
        (event) => {
          const link = event.target;
          if (link instanceof HTMLLinkElement && link.href.endsWith('/assets/style.css')) {
            Reflect.set(window, '__hpmInitialStyleFailure', {
              sheetPresent: link.sheet !== null,
              runtimePresent: Reflect.has(window, 'HexoPostMap'),
            });
          }
        },
        true,
      );
    });
    await page.route(`**${stylePath}`, async (route) => {
      if (repaired) await route.continue();
      else if (failure === '404')
        await route.fulfill({ status: 404, contentType: 'text/css', body: '' });
      else await route.abort('failed');
    });
    await page.route('**/blog/hexo-post-map/assets/runtime.js', (route) => {
      deferredRuntime = route;
    });
    try {
      await page.goto('/blog/posts/single/', { waitUntil: 'commit' });
      await expect.poll(() => Boolean(deferredRuntime)).toBe(true);
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, '__hpmInitialStyleFailure')))
        .toEqual({ sheetPresent: true, runtimePresent: false });
      const canvas = page.locator('[data-hpm-canvas]');
      await expect(canvas).not.toHaveCSS('height', '220px');
      await deferredRuntime!.continue();
      deferredRuntime = undefined;
      await page.waitForLoadState('load');
      const root = page.locator('[data-hpm-detail]');
      await expect(root.locator('[data-hpm-status]')).toHaveText(
        '地图暂时无法加载，请使用下方地点链接。',
      );
      await expect(root).not.toHaveAttribute('data-hpm-active', 'true');
      await expect(root.locator('[data-hpm-fallback]')).toBeVisible();
      expect(network.local[stylePath]).toBe(1);
      expect(network.sdkRequests).toBe(0);

      repaired = true;
      await root.evaluate((root) => {
        const api = Reflect.get(window, 'HexoPostMap');
        api.refresh(root);
        api.refresh(root);
      });
      await expect(root).toHaveAttribute('data-hpm-active', 'true');
      await expect(canvas).toHaveCSS('height', '220px');
      await expect(root.locator('.hpm-detail-marker')).toHaveCSS('width', '44px');
      await root.evaluate((root) => Reflect.get(window, 'HexoPostMap').refresh(root));
      expect(network.local[stylePath]).toBe(2);
      expect(network.local['/blog/hexo-post-map/assets/post-map.js']).toBe(1);
      await expect(page.locator(`link[href$="${stylePath}"]`)).toHaveCount(1);
      expect(network.sdkRequests).toBe(1);
    } finally {
      if (deferredRuntime) await deferredRuntime.abort();
      await page.unroute(`**${stylePath}`);
      await page.unroute('**/blog/hexo-post-map/assets/runtime.js');
    }
  });
}

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

test('a tracked root removed during fetch aborts once and rejects a late response', async ({
  page,
  network,
}) => {
  await observeTrackAbortWithoutCancellingTransport(page);
  await installTrackedPage(page);
  let delayed: Route | undefined;
  await page.route(`**${TRACK_ASSET_PATH}`, (route) => {
    delayed = route;
  });
  try {
    await page.goto('/blog/posts/plain/');
    await replaceHostFrom(page, '/blog/posts/route/');
    await expect.poll(() => Boolean(delayed)).toBe(true);
    const removed = await page.locator('[data-hpm-detail]').elementHandle();
    expect(removed).not.toBeNull();
    await clearHost(page);
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__hpmTrackAborts'))).toBe(1);
    await delayed!.fulfill({ contentType: 'application/json', body: TRACK_ASSET_BODY });
    delayed = undefined;
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, '__hpmLateTrackResponses')))
      .toBe(1);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(network.local[TRACK_ASSET_PATH]).toBe(1);
    expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps.length)).toBe(0);
    expect(
      await removed!.evaluate((root) => ({
        connected: root.isConnected,
        active: root.getAttribute('data-hpm-active'),
        controlsHidden: root.querySelector<HTMLElement>('[data-hpm-playback]')!.hidden,
      })),
    ).toEqual({ connected: false, active: 'false', controlsHidden: true });
    await removed!.dispose();
  } finally {
    if (delayed) await delayed.abort();
    await page.unroute(`**${TRACK_ASSET_PATH}`);
  }
});

test('a tracked root removed during conversion destroys once and ignores every late batch', async ({
  page,
}) => {
  await delayTrackConversions(page);
  await installTrackedPage(page);
  await page.goto('/blog/posts/plain/');
  await replaceHostFrom(page, '/blog/posts/route/');
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, '__hpmSdk')?.pendingConversions.length ?? 0),
    )
    .toBe(1);
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').conversionBatches.length)).toBe(
    0,
  );
  const removed = await page.locator('[data-hpm-detail]').elementHandle();
  await clearHost(page);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__hpmSdk').destroyedMaps))
    .toBe(1);
  await page.evaluate(() => Reflect.get(window, '__hpmSdk').releaseAllConversions());
  await page.evaluate(() => Promise.resolve());
  expect(
    await page.evaluate(() => ({
      maps: Reflect.get(window, '__hpmSdk').maps.length,
      destroyedMaps: Reflect.get(window, '__hpmSdk').destroyedMaps,
      batches: Reflect.get(window, '__hpmSdk').conversionBatches.length,
      polylines: Reflect.get(window, '__hpmSdk').polylines.length,
      active: document.querySelectorAll('[data-hpm-active="true"]').length,
    })),
  ).toEqual({ maps: 1, destroyedMaps: 1, batches: 1, polylines: 0, active: 0 });
  expect(await removed!.getAttribute('data-hpm-active')).toBe('false');
  await removed!.dispose();
});

test('tracked PJAX replacement owns a fresh mount and cancelled playback cannot mutate it', async ({
  page,
  network,
}) => {
  await installControlledAnimationFrames(page);
  await installTrackedPage(page);
  await page.goto('/blog/posts/plain/');
  await replaceHostFrom(page, '/blog/posts/route/');
  let root = page.locator('[data-hpm-detail]');
  await expect(root).toHaveAttribute('data-hpm-active', 'true');
  await root.locator('[data-hpm-play]').click();
  await fireAnimationFrame(page, 1_000);
  await fireAnimationFrame(page, 16_000);
  const removed = await root.elementHandle();
  expect(
    await removed!.evaluate(
      (element) => element.querySelector<HTMLInputElement>('[data-hpm-progress]')!.value,
    ),
  ).toBe('0.5');
  expect(await pendingAnimationFrames(page)).toBe(1);

  await replaceHostFrom(page, '/blog/posts/route/');
  root = page.locator('[data-hpm-detail]');
  await expect(root).toHaveAttribute('data-hpm-active', 'true');
  await expect(root.locator('[data-hpm-progress]')).toHaveValue('0');
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__hpmSdk').destroyedMaps))
    .toBe(1);
  expect(network.local[TRACK_ASSET_PATH]).toBe(2);
  await root.evaluate((element) => {
    const api = Reflect.get(window, 'HexoPostMap');
    api.refresh(element);
    api.refresh(element);
  });
  expect(network.local[TRACK_ASSET_PATH]).toBe(2);
  await fireCancelledAnimationFrames(page, 31_000);
  expect(
    await removed!.evaluate(
      (element) => element.querySelector<HTMLInputElement>('[data-hpm-progress]')!.value,
    ),
  ).toBe('0.5');
  await expect(root.locator('[data-hpm-progress]')).toHaveValue('0');

  await clearHost(page);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__hpmSdk').destroyedMaps))
    .toBe(2);
  await clearHost(page);
  expect(
    await page.evaluate(() => ({
      destroyedMaps: Reflect.get(window, '__hpmSdk').destroyedMaps,
      destroyedTrackOverlays: Reflect.get(window, '__hpmSdk').destroyedTrackOverlays,
      active: document.querySelectorAll('[data-hpm-active="true"]').length,
    })),
  ).toEqual({ destroyedMaps: 2, destroyedTrackOverlays: 14, active: 0 });
  await removed!.dispose();
});

test('persisted page lifecycle preserves a manual track position without starting playback', async ({
  page,
  network,
}) => {
  await installControlledAnimationFrames(page);
  await installTrackedPage(page);
  await page.goto('/blog/posts/route/');
  const range = page.locator('[data-hpm-progress]');
  await expect(range).toBeVisible();
  await range.evaluate((element: HTMLInputElement) => {
    element.value = '0.37';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(range).toHaveValue('0.37');
  await expect(range).toHaveAttribute('aria-valuetext', '行程进度 37%');
  await expect(page.locator('[data-hpm-play]')).toHaveAttribute('aria-pressed', 'false');
  expect(await pendingAnimationFrames(page)).toBe(0);
  expect(network.local[TRACK_ASSET_PATH]).toBe(1);
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').destroyedMaps)).toBe(0);
});
