import { createServer } from 'node:http';
import { chromium, expect, test, type Browser, type Locator, type Page } from 'playwright/test';
import { fakeSdk } from './fake-sdk';

async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  // Always leave any restored focus first so each visit tests actual Tab navigation.
  for (let press = 0; press < 30; press++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  await expect(target).toBeFocused();
}

test('real Chromium back/forward cache preserves usable detail and overview controllers', async () => {
  // Request interception disables BFCache. Serve the packed fixture unchanged except for a
  // deterministic preloaded SDK and a CSP that blocks every non-local network request.
  const preload = fakeSdk.replace('window.___onAPILoaded();', '');
  const instrumentation = `window.__hpmCache = { id: Math.random(), restores: 0 };
    addEventListener('pageshow', event => { if (event.persisted) window.__hpmCache.restores++; });`;
  const server = createServer(async (request, response) => {
    try {
      const source = await fetch(`http://127.0.0.1:4179${request.url}`);
      const contentType = source.headers.get('content-type') ?? 'application/octet-stream';
      response.writeHead(source.status, {
        'Content-Type': contentType,
        'Content-Security-Policy':
          "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'",
      });
      if (contentType.includes('text/html')) {
        const html = await source.text();
        response.end(
          html.replace(
            '<head>',
            `<head><script>${preload}</script><script>${instrumentation}</script>`,
          ),
        );
      } else response.end(Buffer.from(await source.arrayBuffer()));
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture server port');
  const origin = `http://127.0.0.1:${address.port}`;
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      channel: 'chromium',
      ignoreDefaultArgs: ['--disable-back-forward-cache'],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(5_000);
    await page.goto(`${origin}/blog/posts/single/`);
    await expect(page.locator('[data-hpm-activate]')).toHaveCount(0);
    const detailMarker = page.locator('.hpm-detail-marker');
    await expect(detailMarker).toBeVisible();
    await expect(page.locator('[data-hpm-detail]')).toHaveAttribute('data-hpm-active', 'true');
    const detailId = await page.evaluate(() => Reflect.get(window, '__hpmCache').id);
    await expect(page.locator('[data-hpm-canvas]')).toHaveAttribute('tabindex', '0');
    await tabTo(page, page.locator('[data-hpm-canvas]'));
    await page.keyboard.press('ArrowRight');
    expect(
      await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].status.keyboardEnable),
    ).toBe(true);
    await detailMarker.click();
    await expect(detailMarker).toHaveAttribute('aria-expanded', 'true');

    await page.goto(`${origin}/blog/map/`);
    await expect(page.locator('[data-hpm-activate]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查看此处的 4 篇文章' })).toBeEnabled();
    const overviewId = await page.evaluate(() => Reflect.get(window, '__hpmCache').id);
    await page.getByRole('button', { name: '查看此处的 4 篇文章' }).click();
    await page.getByRole('button', { name: '查看此处的 2 篇文章' }).click();
    await expect(page.getByRole('dialog', { name: '2 篇文章' })).toBeVisible();

    for (let visit = 1; visit <= 2; visit++) {
      await page.goBack({ waitUntil: 'commit' });
      await expect(page).toHaveURL(`${origin}/blog/posts/single/`);
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, '__hpmCache')))
        .toEqual({ id: detailId, restores: visit });
      expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps.length)).toBe(1);
      await expect(page.locator('[data-hpm-activate]')).toHaveCount(0);
      await expect(detailMarker).toBeVisible();
      await expect(detailMarker).toHaveAttribute('aria-expanded', 'false');
      await expect(detailMarker.locator('..').getByRole('tooltip')).toBeHidden();
      const canvas = page.locator('[data-hpm-canvas]');
      await expect(canvas).toHaveAttribute('tabindex', '0');
      await tabTo(page, canvas);
      await page.keyboard.press('ArrowRight');
      await expect(canvas).toBeFocused();
      expect(
        await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].status.keyboardEnable),
      ).toBe(true);
      await expect(canvas.locator('button')).toHaveCount(1);
      await expect(canvas.locator('a, .amap-info-window')).toHaveCount(0);
      await expect(page.locator('[data-hpm-fallback]')).toBeHidden();
      await detailMarker.click();
      await expect(detailMarker).toHaveAttribute('aria-expanded', 'true');

      await page.goForward({ waitUntil: 'commit' });
      await expect(page).toHaveURL(`${origin}/blog/map/`);
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, '__hpmCache')))
        .toEqual({ id: overviewId, restores: visit });
      expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps.length)).toBe(1);
      await expect(page.locator('[data-hpm-activate]')).toHaveCount(0);
      await expect(page.locator('[data-hpm-show-list]')).toHaveCount(1);
      const panel = page.getByRole('dialog', { name: '2 篇文章' });
      await expect(panel.locator('li')).toHaveCount(2);
      await panel.getByRole('button', { name: '关闭文章面板' }).click();
      const overlap = page.getByRole('button', { name: '查看此处的 2 篇文章' });
      await expect(overlap).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(panel).toBeVisible();
    }

    await page.goBack({ waitUntil: 'commit' });
    await expect(page).toHaveURL(`${origin}/blog/posts/single/`);
    const canvas = page.locator('[data-hpm-canvas]');
    await tabTo(page, canvas);
    // Dispatch ordinary pagehide in place to inspect the destroyed document's Tab order.
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })),
    );
    await expect(canvas).toHaveAttribute('tabindex', '-1');
    await expect(page.locator('[data-hpm-detail]')).toHaveAttribute('data-hpm-active', 'false');
    await expect(detailMarker).toHaveCount(0);
    await expect(page.locator('[data-hpm-fallback]')).toBeVisible();
    for (let press = 0; press < 8; press++) {
      await page.keyboard.press('Tab');
      await expect(canvas).not.toBeFocused();
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
