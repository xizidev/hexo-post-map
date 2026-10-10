import { readFile } from 'node:fs/promises';
import { parse, stringify } from 'yaml';
import type { Page } from 'playwright/test';
import { test, expect } from './author-fixtures';
import { importAuthorYaml } from '../src/author/yaml';
import { normalizePostMapDocument } from '../src/domain/normalize';

async function addManual(page: Page, name: string, longitude = '121.4737', latitude = '31.2304') {
  await page.getByRole('button', { name: '手动新增地点' }).click();
  await page.getByLabel('地点名称').fill(name);
  await page.getByLabel('经度', { exact: true }).fill(longitude);
  await page.getByLabel('纬度', { exact: true }).fill(latitude);
  await page.getByRole('button', { name: '确认添加地点' }).click();
}
async function importMap(page: Page, yaml: string, valid = true) {
  await page.getByRole('button', { name: '导入 YAML', exact: true }).click();
  await page.getByLabel('粘贴完整 map: 配置').fill(yaml);
  await page.getByRole('button', { name: '校验导入' }).click();
  if (valid) await page.getByRole('button', { name: '确认替换当前草稿' }).click();
  else {
    await expect(page.locator('[data-import-error]')).not.toBeEmpty();
    await page.getByRole('button', { name: '取消', exact: true }).click();
  }
}
async function exported(page: Page) {
  await expect(page.locator('[data-copy]')).toBeEnabled();
  return parse((await page.locator('[data-yaml]').textContent()) ?? '') as {
    map: {
      points: { id: string; name: string; longitude: number }[];
      representative?: string;
      route?: string[];
      zoom?: number;
      track?: unknown;
    };
  };
}

test('import fits once after map readiness and coordinate summaries retain precision', async ({
  page,
  editorUrl,
}) => {
  void editorUrl;
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__hpmSdk')?.maps.length ?? 0))
    .toBe(1);
  await page.evaluate(() => {
    const prototype = Object.getPrototypeOf(Reflect.get(window, '__hpmSdk').maps[0]);
    const original = prototype.setFitView;
    Reflect.set(window, '__authorFitCalls', 0);
    prototype.setFitView = function (...args: unknown[]) {
      Reflect.set(window, '__authorFitCalls', Reflect.get(window, '__authorFitCalls') + 1);
      return original.apply(this, args);
    };
  });
  await importMap(
    page,
    stringify({
      map: {
        points: [
          { id: 'a', name: 'Same name', longitude: -73.12345678912345, latitude: 40 },
          { id: 'b', name: 'Same name', longitude: -74, latitude: 41 },
        ],
        representative: 'a',
        zoom: 21,
      },
    }),
  );
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__authorFitCalls'))).toBe(1);
  await expect(page.locator('[data-point-id=a] [data-coordinate-summary]')).toContainText(
    '-73.12345678912345',
  );
  await page.getByLabel('经度', { exact: true }).fill('-72.12345678912345');
  await page.evaluate(() =>
    Reflect.get(window, '__hpmSdk').maps.at(-1).setZoomAndCenter(10, [-70, 42]),
  );
  const value = await exported(page);
  expect(value.map.points[0]?.longitude).toBe(-72.12345678912345);
  expect(value.map.zoom).toBe(21);
  expect(await page.evaluate(() => Reflect.get(window, '__authorFitCalls'))).toBe(1);
});

for (const route of [
  ['a', 'b', 'c'],
  ['a', 'b', 'a'],
]) {
  test(`route keyboard focus follows the moved occurrence twice for ${route.join(' ')}`, async ({
    page,
    editorUrl,
  }) => {
    void editorUrl;
    await importMap(
      page,
      stringify({
        map: {
          points: ['a', 'b', 'c'].map((id, index) => ({
            id,
            name: id.toUpperCase(),
            longitude: 120 + index,
            latitude: 31,
          })),
          representative: 'a',
          route,
        },
      }),
    );
    await page.locator('[data-route-index="0"] [data-down]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-route-index="1"] [data-down]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-route-index="2"] [data-remove]')).toBeFocused();
    expect((await exported(page)).map.route).toEqual([route[1], route[2], route[0]]);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-route-index="1"] [data-remove]')).toBeFocused();
  });
}

for (const pending of ['committed', 'candidate']) {
  test(`persisted lifecycle restores ${pending} pending input and export validation`, async ({
    page,
    editorUrl,
  }) => {
    void editorUrl;
    await addManual(page, 'Committed A');
    if (pending === 'candidate') {
      await page.locator('[data-map]').click({ position: { x: 20, y: 20 } });
      await page.getByLabel('地点名称').fill('Unconfirmed candidate');
    }
    await page.getByLabel('经度', { exact: true }).fill('1e+');
    await page.getByLabel('文章缩放（可选，新增值 2–20）').fill('1e');
    await expect(page.locator('[data-copy]')).toBeDisabled();
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect(page.locator('[data-point-form]')).toHaveAttribute('data-mounted', 'true');
    await expect(page.getByLabel('经度', { exact: true })).toHaveValue('1e+');
    await expect(page.getByLabel('文章缩放（可选，新增值 2–20）')).toHaveValue('1e');
    await expect(page.locator('[data-copy]')).toBeDisabled();
    await expect(page.locator('[data-yaml]')).toContainText('过期');
    await expect(page.locator('[data-point-id]')).toHaveCount(1);
    if (pending === 'candidate')
      await expect(page.getByLabel('地点名称')).toHaveValue('Unconfirmed candidate');
  });
}

test('deleting the only point restores focus to the labelled new name field', async ({
  page,
  editorUrl,
}) => {
  void editorUrl;
  await addManual(page, 'Only point');
  await page.locator('[data-delete]').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByLabel('地点名称')).toBeFocused();
  await expect(page.locator('[data-copy]')).toBeDisabled();
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}×${viewport.height} packed author`, () => {
    test.use({ viewport });
    test('selects points, representative and A B A, copies/downloads real YAML, preserves attribution layout', async ({
      page,
      context,
      editorUrl,
    }, testInfo) => {
      expect(new URL(editorUrl).origin).toBe('http://127.0.0.1:4180');
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, '__hpmSdk')?.maps.length ?? 0))
        .toBe(1);
      await page.locator('[data-map]').click({ position: { x: 20, y: 20 } });
      await expect(page.getByLabel('经度', { exact: true })).toHaveValue('121.4737');
      await page.getByLabel('地点名称').fill('A');
      await page.getByRole('button', { name: '确认添加地点' }).click();
      await addManual(page, 'B', '121.4837', '31.2404');
      const points = page.locator('[data-point-id]');
      await expect(points).toHaveCount(2);
      await points.nth(1).getByRole('radio').check();
      for (const index of [0, 1, 0])
        await points.nth(index).getByRole('button', { name: '加入线路' }).click();
      await points.nth(1).getByRole('button', { name: 'B', exact: true }).click();
      await page.evaluate(() => {
        const marker = Reflect.get(window, '__hpmSdk').markers.find(
          (marker: { options: { draggable: boolean; content?: HTMLElement } }) =>
            marker.options.draggable && marker.options.content?.getAttribute('aria-label') === 'B',
        );
        marker.emit('dragend', {
          lnglat: { getLng: () => 121.49, getLat: () => 31.25 },
          originEvent: new Event('dragend'),
        });
      });
      const value = await exported(page);
      expect(value.map.representative).toBe('point-2');
      expect(value.map.route).toEqual(['point-1', 'point-2', 'point-1']);
      expect(value.map.points[1]?.longitude).toBe(121.49);
      expect(value.map.zoom).toBeUndefined();
      expect(normalizePostMapDocument(value.map, 'download.yaml')?.map.representative.id).toBe(
        'point-2',
      );
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.getByRole('button', { name: '复制 YAML', exact: true }).click();
      await expect(page.locator('[data-export-status]')).toHaveText('已复制 YAML');
      expect(parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(value);
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }),
      );
      await page.getByRole('button', { name: '复制 YAML', exact: true }).click();
      const fallback = page.getByLabel('手动复制 YAML（请选择并复制）');
      await expect(fallback).toBeFocused();
      expect(importAuthorYaml(await fallback.inputValue()).ok).toBe(true);
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: '下载 YAML', exact: true }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe('post-map.yaml');
      const body = await readFile((await file.path())!, 'utf8');
      expect(importAuthorYaml(body).ok).toBe(true);
      expect(parse(body)).toEqual(value);
      await importMap(page, body);
      expect(await exported(page)).toEqual(value);
      const layout = await page.evaluate(() => {
        const rect = (selector: string) =>
          document.querySelector(selector)!.getBoundingClientRect();
        const map = rect('.map-panel'),
          editor = rect('.editor-panel');
        return {
          map: { right: map.right, bottom: map.bottom },
          editor: { x: editor.x, y: editor.y },
        };
      });
      if (viewport.width > 760) expect(layout.map.right).toBeLessThan(layout.editor.x);
      else expect(layout.map.bottom).toBeLessThan(layout.editor.y);
      const attribution = page.getByText('坐标系：GCJ-02 · 地图数据及署名由高德地图提供');
      await attribution.scrollIntoViewIfNeeded();
      await expect(attribution).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('author-layout.png'), fullPage: true });
      const attributionBounds = await attribution.boundingBox();
      const editorBounds = await page.locator('.editor-panel').boundingBox();
      const mapBounds = await page.locator('.map-panel').boundingBox();
      expect(attributionBounds!.x).toBeGreaterThanOrEqual(mapBounds!.x);
      expect(attributionBounds!.x + attributionBounds!.width).toBeLessThanOrEqual(
        mapBounds!.x + mapBounds!.width,
      );
      expect(attributionBounds!.y + attributionBounds!.height).toBeLessThanOrEqual(
        mapBounds!.y + mapBounds!.height,
      );
      if (viewport.width < 760)
        expect(attributionBounds!.y + attributionBounds!.height).toBeLessThanOrEqual(
          editorBounds!.y,
        );
      await points.nth(1).getByRole('button', { name: '删除', exact: true }).click();
      await page.getByRole('button', { name: '确认删除', exact: true }).click();
      await expect(page.locator('[data-copy]')).toBeDisabled();
      await expect(page.locator('[data-download]')).toBeDisabled();
      await points.first().getByRole('radio').check();
      await expect(page.locator('[data-copy]')).toBeEnabled();
    });
    test('200 points scroll inside the list, keyboard reorder and 44px targets remain usable', async ({
      page,
      editorUrl,
    }) => {
      void editorUrl;
      await importMap(
        page,
        stringify({
          map: {
            representative: 'p0',
            points: Array.from({ length: 200 }, (_, index) => ({
              id: `p${index}`,
              name: `地点 ${index}`,
              longitude: 121 + index / 10000,
              latitude: 31,
            })),
          },
        }),
      );
      const list = page.getByRole('list', { name: '地点列表', exact: true });
      await expect(list.locator('li')).toHaveCount(200);
      expect(
        await list.evaluate(
          (element) =>
            element.scrollHeight > element.clientHeight &&
            getComputedStyle(element).overflowY === 'auto',
        ),
      ).toBe(true);
      await list.locator('li').first().getByRole('button', { name: '下移', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(list.locator('li').first()).toHaveAttribute('data-point-id', 'p1');
      await expect(list.locator('[data-point-id=p0] [data-down]')).toBeFocused();
      await list.locator('li').last().scrollIntoViewIfNeeded();
      expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(
        await page
          .locator(
            '[data-author-root] button, [data-author-root] input, [data-author-root] textarea, [data-author-root] summary',
          )
          .evaluateAll((elements) =>
            elements
              .filter((element) => element.getClientRects().length)
              .every((element) => {
                const bounds = element.getBoundingClientRect();
                return bounds.height >= 44 && bounds.width >= 44;
              }),
          ),
      ).toBe(true);
    });
  });
}

test('failed import preserves data; malicious names are text; raw zoom 21 and readonly track never request files', async ({
  page,
  editorUrl,
  network,
}) => {
  void editorUrl;
  const track = {
    source: './private-never-fetch.gpx',
    privacy: { trim_start_meters: 10 },
    playback: false,
  };
  await importMap(
    page,
    stringify({
      map: {
        points: [{ id: 'a', name: '<img src=x onerror=alert(1)>', longitude: 121, latitude: 31 }],
        zoom: 21,
        track,
      },
    }),
  );
  await expect(page.locator('[data-point-list] img, [data-point-list] script')).toHaveCount(0);
  await expect(page.locator('[data-zoom-warning]')).toContainText('已保留');
  const before = await exported(page);
  await importMap(page, 'map:\n  points: nope\n', false);
  expect(await exported(page)).toEqual(before);
  expect(before.map.zoom).toBe(21);
  expect(before.map.track).toEqual(track);
  expect(importAuthorYaml(stringify(before)).ok).toBe(true);
  expect(network.local.some((path) => /private-never-fetch|tracks\//u.test(path))).toBe(false);
  expect(network.denied).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test.describe('unavailable SDK', () => {
  test.use({ sdkUnavailable: true });
  test('map network failure still permits manual editing and export', async ({
    page,
    editorUrl,
    network,
  }) => {
    void editorUrl;
    await expect(page.locator('[data-map-status]')).toContainText('暂不可用');
    await addManual(page, '手动地点');
    expect((await exported(page)).map.points[0]?.name).toBe('手动地点');
    expect(network.sdkRequests).toBe(1);
  });
});

test('author traces remain disabled under the reader CI trace option', async ({ trace }) => {
  expect(trace).toBe('off');
});

test('author network denies unknown local ports and remote origins', async ({
  page,
  editorUrl,
  network,
}) => {
  void editorUrl;
  const result = await page.evaluate(async () =>
    Promise.all(
      ['http://127.0.0.1:4181/', 'http://localhost:4180/', 'https://example.invalid/'].map(
        async (url) => {
          try {
            await fetch(url);
            return true;
          } catch {
            return false;
          }
        },
      ),
    ),
  );
  expect(result).toEqual([false, false, false]);
  expect(network.denied.sort()).toEqual(
    ['http://127.0.0.1:4181', 'http://localhost:4180', 'https://example.invalid'].sort(),
  );
});

for (const media of [
  { colorScheme: 'dark' as const },
  { forcedColors: 'active' as const },
  { reducedMotion: 'reduce' as const },
]) {
  test(`author controls remain usable with ${Object.keys(media)[0]}`, async ({
    page,
    editorUrl,
  }) => {
    void editorUrl;
    await page.emulateMedia(media);
    await addManual(page, 'Accessible point');
    await page.getByRole('button', { name: '复制 YAML', exact: true }).focus();
    await expect(page.getByRole('button', { name: '复制 YAML', exact: true })).toBeFocused();
    expect((await exported(page)).map.points[0]?.name).toBe('Accessible point');
    await expect(page.getByText('刷新或关闭页面会清空草稿，请导出后保存。')).toBeVisible();
  });
}

test('BFCache remounts exactly once and late map and clipboard callbacks cannot update the draft', async ({
  page,
  editorUrl,
}) => {
  void editorUrl;
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__hpmSdk')?.maps.length ?? 0))
    .toBe(1);
  await addManual(page, 'A');
  await page.evaluate(() => {
    const sdk = Reflect.get(window, '__hpmSdk');
    Reflect.set(window, '__lateMapClick', [...sdk.maps[0].events.click][0]);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => new Promise<void>((resolve) => Reflect.set(window, '__lateCopy', resolve)),
      },
    });
  });
  await page.getByRole('button', { name: '复制 YAML', exact: true }).click();
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
  );
  await expect(page.locator('[data-point-form]')).not.toHaveAttribute('data-mounted', 'true');
  await page.evaluate(() => {
    Reflect.get(window, '__lateMapClick')({ lnglat: { getLng: () => 0, getLat: () => 0 } });
    Reflect.get(window, '__lateCopy')();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('[data-point-form]')).toHaveAttribute('data-mounted', 'true');
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__hpmSdk').maps.length)).toBe(2);
  await expect(page.locator('[data-point-id]')).toHaveCount(1);
  await expect(page.getByLabel('经度', { exact: true })).toHaveValue('121.4737');
  await expect(page.locator('[data-export-status]')).toBeEmpty();
  await page.getByLabel('地点名称').fill('After return');
  expect((await exported(page)).map.points[0]?.name).toBe('After return');
});
