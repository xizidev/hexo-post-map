import { createServer } from 'node:http';
import { chromium, expect, test, type Browser } from 'playwright/test';
import { fakeSdk } from './fake-sdk';

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
    await page.locator('[data-hpm-canvas]').focus();
    await page.keyboard.press('ArrowRight');
    expect(
      await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].status.keyboardEnable),
    ).toBe(true);

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
      await expect(detailMarker).toBeEmpty();
      const canvas = page.locator('[data-hpm-canvas]');
      await canvas.focus();
      await page.keyboard.press('ArrowRight');
      await expect(canvas).toBeFocused();
      expect(
        await page.evaluate(() => Reflect.get(window, '__hpmSdk').maps[0].status.keyboardEnable),
      ).toBe(true);
      await expect(canvas.locator('button, a, .hpm-place-card')).toHaveCount(0);
      await expect(page.locator('[data-hpm-fallback]')).toBeHidden();

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
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
