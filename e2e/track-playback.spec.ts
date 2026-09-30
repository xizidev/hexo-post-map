import {
  expect,
  fireAnimationFrame,
  installControlledAnimationFrames,
  installTrackedPage,
  pendingAnimationFrames,
  test,
  TRACK_ASSET_BODY,
  TRACK_ASSET_DIGEST,
  TRACK_ASSET_PATH,
  TRACK_POINT_COUNT,
} from './fixtures';

test('recorded track stays detail-only and loads once at the lazy viewport boundary', async ({
  page,
  network,
}) => {
  await installTrackedPage(page);
  await page.goto('/blog/posts/plain/');
  expect(network.local[TRACK_ASSET_PATH] ?? 0).toBe(0);
  await page.goto('/blog/map/');
  await expect(page.locator('[data-hpm-overview]')).toHaveAttribute('data-hpm-active', 'true');
  expect(network.local[TRACK_ASSET_PATH] ?? 0).toBe(0);

  await page.addInitScript(() => {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        const root = document.querySelector<HTMLElement>('[data-hpm-detail]');
        if (root) root.style.marginTop = '200vh';
      },
      { once: true },
    );
  });
  await page.goto('/blog/posts/route/');
  const root = page.locator('[data-hpm-detail]');
  expect(network.local[TRACK_ASSET_PATH] ?? 0).toBe(0);
  await expect(root.locator('[data-hpm-fallback]')).toBeVisible();
  await root.scrollIntoViewIfNeeded();
  await expect(root).toHaveAttribute('data-hpm-active', 'true');
  expect(network.local[TRACK_ASSET_PATH]).toBe(1);
  await root.evaluate((element) => {
    const api = Reflect.get(window, 'HexoPostMap');
    api.refresh(element);
    api.refresh(element);
  });
  expect(network.local[TRACK_ASSET_PATH]).toBe(1);
});

test('real WGS84 segments convert in official-size batches and replace only the schematic line', async ({
  page,
  network,
}) => {
  await installTrackedPage(page);
  await page.goto('/blog/posts/route/');
  const root = page.locator('[data-hpm-detail]');
  await expect(root).toHaveAttribute('data-hpm-active', 'true');
  expect(TRACK_ASSET_DIGEST).toMatch(/^[0-9a-f]{64}$/u);
  expect(network.local[TRACK_ASSET_PATH]).toBe(1);
  expect(
    await page.evaluate(() => {
      const sdk = Reflect.get(window, '__hpmSdk');
      return {
        batchLengths: sdk.conversionBatches.map((batch: unknown[]) => batch.length),
        convertedPoints: sdk.conversionBatches.flat().length,
        pointPins: document.querySelectorAll('.hpm-detail-marker').length,
        schematicLines: sdk.polylines.filter(
          (line: { options: { strokeWeight: number } }) => line.options.strokeWeight === 3,
        ).length,
        trackLines: sdk.polylines.filter(
          (line: { options: { strokeWeight: number } }) => line.options.strokeWeight === 5,
        ).length,
        progressUpdates: sdk.polylineUpdates.length,
      };
    }),
  ).toEqual({
    batchLengths: [40, 40, 7],
    convertedPoints: TRACK_POINT_COUNT,
    pointPins: 3,
    schematicLines: 0,
    trackLines: 6,
    progressUpdates: 0,
  });
  await expect(root.locator('[data-hpm-progress]')).toHaveValue('0');
  await expect(root.locator('[data-hpm-play]')).toHaveAttribute('aria-pressed', 'false');
  const publicText = (await root.textContent()) + TRACK_ASSET_BODY;
  expect(publicText).not.toMatch(/private-track|_posts|\.gpx|2026-01-01T|PRIVATE_/u);
});

test('play, pause, restart, seek, and completion use controlled animation frames without autoplay', async ({
  page,
}) => {
  await installControlledAnimationFrames(page);
  await installTrackedPage(page);
  await page.goto('/blog/posts/route/');
  const controls = page.locator('[data-hpm-playback]');
  const play = page.locator('[data-hpm-play]');
  const restart = page.getByRole('button', { name: '重新开始', exact: true });
  const range = page.getByRole('slider', { name: '轨迹播放进度' });
  await expect(controls).toBeVisible();
  await expect(play).toHaveAccessibleName('播放');
  await expect(range).toHaveAttribute('aria-valuetext', '行程进度 0%');
  expect(await pendingAnimationFrames(page)).toBe(0);

  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  expect(await pendingAnimationFrames(page)).toBe(1);
  await fireAnimationFrame(page, 1_000);
  await fireAnimationFrame(page, 16_000);
  await expect(range).toHaveValue('0.5');
  await expect(range).toHaveAttribute('aria-valuetext', '行程进度 50%');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  expect(await pendingAnimationFrames(page)).toBe(0);

  await range.evaluate((element: HTMLInputElement) => {
    element.value = '0.42';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(range).toHaveAttribute('aria-valuetext', '行程进度 42%');
  await restart.click();
  await expect(range).toHaveValue('0');
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await fireAnimationFrame(page, 20_000);
  await fireAnimationFrame(page, 50_000);
  await expect(range).toHaveValue('1');
  await expect(range).toHaveAttribute('aria-valuetext', '行程进度 100%');
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  expect(await pendingAnimationFrames(page)).toBe(0);
  const progressEffects = await page.evaluate(() => ({
    polylineUpdates: Reflect.get(window, '__hpmSdk').polylineUpdates.length,
    markerPositions: Reflect.get(window, '__hpmSdk').markerPositions.length,
  }));
  expect(progressEffects.polylineUpdates).toBeGreaterThan(0);
  expect(progressEffects.markerPositions).toBeGreaterThanOrEqual(6);
});

test('playback disabled renders only the complete muted track', async ({ page }) => {
  await installTrackedPage(page, { playback: false });
  await page.goto('/blog/posts/route/');
  await expect(page.locator('[data-hpm-detail]')).toHaveAttribute('data-hpm-active', 'true');
  await expect(page.locator('[data-hpm-playback]')).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const sdk = Reflect.get(window, '__hpmSdk');
      return {
        full: sdk.polylines.filter(
          (line: { options: { strokeWeight: number; strokeOpacity?: number } }) =>
            line.options.strokeWeight === 5 && line.options.strokeOpacity === 0.55,
        ).length,
        progress: sdk.polylines.filter(
          (line: { options: { strokeWeight: number; strokeOpacity?: number } }) =>
            line.options.strokeWeight === 5 && line.options.strokeOpacity === undefined,
        ).length,
        moving: document.querySelectorAll('.hpm-track-marker').length,
        schematic: sdk.polylines.filter(
          (line: { options: { strokeWeight: number } }) => line.options.strokeWeight === 3,
        ).length,
      };
    }),
  ).toEqual({ full: 3, progress: 0, moving: 0, schematic: 0 });
});

for (const failure of [
  { name: 'fetch', options: { assetStatus: 503, assetBody: 'PRIVATE_FETCH_BODY' } },
  { name: 'JSON', options: { assetBody: '{PRIVATE_JSON_BODY' } },
  {
    name: 'validation',
    options: {
      assetBody: JSON.stringify({
        version: 1,
        coordinateSystem: 'gcj02',
        segments: [
          [
            [118.7, 32],
            [118.8, 32.1],
          ],
        ],
        stats: { distanceMeters: 1 },
        privateProperty: 'PRIVATE_VALIDATION_BODY',
      }),
    },
  },
] as const) {
  test(`${failure.name} failure keeps pins and the schematic route with one generic status`, async ({
    page,
  }) => {
    await installTrackedPage(page, failure.options);
    await page.goto('/blog/posts/route/');
    const root = page.locator('[data-hpm-detail]');
    await expect(root).toHaveAttribute('data-hpm-active', 'true');
    await expect(root.locator('[data-hpm-status]')).toHaveText(
      '轨迹暂时无法加载，已显示地点路线。',
    );
    await expect(root.locator('[data-hpm-playback]')).toBeHidden();
    await expect(root.locator('.hpm-detail-marker')).toHaveCount(3);
    expect(
      await page.evaluate(() =>
        Reflect.get(window, '__hpmSdk').polylines.map(
          (line: { options: { strokeWeight: number } }) => line.options.strokeWeight,
        ),
      ),
    ).toEqual([3]);
    expect(await root.textContent()).not.toContain('PRIVATE_');
    expect(await root.locator('[data-hpm-status]').textContent()).not.toContain(TRACK_ASSET_PATH);
  });
}

test('coordinate conversion failure keeps a coordinate-safe schematic fallback', async ({
  page,
}) => {
  await page.addInitScript(() => Reflect.set(window, '__hpmSdkConversionFailure', true));
  await installTrackedPage(page);
  await page.goto('/blog/posts/route/');
  const root = page.locator('[data-hpm-detail]');
  await expect(root).toHaveAttribute('data-hpm-active', 'true');
  await expect(root.locator('[data-hpm-status]')).toHaveText('轨迹暂时无法加载，已显示地点路线。');
  expect(
    await page.evaluate(() => ({
      batchLengths: Reflect.get(window, '__hpmSdk').conversionBatches.map(
        (batch: unknown[]) => batch.length,
      ),
      weights: Reflect.get(window, '__hpmSdk').polylines.map(
        (line: { options: { strokeWeight: number } }) => line.options.strokeWeight,
      ),
      moving: document.querySelectorAll('.hpm-track-marker').length,
    })),
  ).toEqual({ batchLengths: [40], weights: [3], moving: 0 });
});

test('provider failure keeps the complete static fallback instead of a partial track UI', async ({
  page,
}) => {
  await installTrackedPage(page);
  await page.route('https://webapi.amap.com/**', (route) => route.abort());
  await page.goto('/blog/posts/route/');
  const root = page.locator('[data-hpm-detail]');
  await expect(root.locator('[data-hpm-status]')).toHaveText(
    '地图暂时无法加载，请使用下方地点链接。',
  );
  await expect(root.locator('[data-hpm-fallback]')).toBeVisible();
  await expect(root.locator('[data-hpm-fallback] a')).toHaveCount(3);
  await expect(root.locator('[data-hpm-playback]')).toBeHidden();
  await expect(page.getByText('The route differs from point declaration order')).toBeVisible();
});
