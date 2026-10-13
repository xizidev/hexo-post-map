import { parse, stringify } from 'yaml';
import type { Page } from 'playwright/test';
import { test, expect } from './author-fixtures';
import { showAuthorCoordinates, showAuthorTab, showPlaceActions } from './author-workspace-helpers';

// Author URLs authorize bootstrap and must not be recorded by Playwright traces.
test.use({ trace: 'off' });

async function importMap(page: Page, points = 2) {
  await page.getByRole('button', { name: '导入 YAML', exact: true }).click();
  await page.getByLabel('粘贴完整 map: 配置').fill(
    stringify({
      map: {
        points: Array.from({ length: points }, (_, index) => ({
          id: `p${index}`,
          name: `地点 ${index}`,
          longitude: 120 + index / 1000,
          latitude: 31,
        })),
        representative: 'p1',
        route: ['p0', 'p1', 'p0'],
      },
    }),
  );
  await page.getByRole('button', { name: '校验导入' }).click();
  await page.getByRole('button', { name: '确认替换当前草稿' }).click();
  await expect(page.locator('[data-point-id]')).toHaveCount(points);
}

async function remount(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('[data-point-form]')).toHaveAttribute('data-mounted', 'true');
}

async function nameIsInEditor(page: Page) {
  await expect(page.getByLabel('地点名称')).toBeFocused();
  const visibility = await page.getByLabel('地点名称').evaluate((field) => {
    const editor = document.querySelector('[data-editor-scroll]')!;
    const viewport = editor.getBoundingClientRect();
    const bounds = field.getBoundingClientRect();
    return {
      visible: bounds.top >= viewport.top && bounds.bottom <= viewport.bottom,
      top: bounds.top,
      bottom: bounds.bottom,
      viewportTop: viewport.top,
      viewportBottom: viewport.bottom,
      scrollTop: editor.scrollTop,
    };
  });
  expect(visibility.visible, JSON.stringify(visibility)).toBe(true);
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}×${viewport.height} packed author workspace`, () => {
    test.use({ viewport });

    test('abandons only the new candidate and protects raw input from another map click', async ({
      page,
      editorUrl,
    }) => {
      void editorUrl;
      await importMap(page);
      await showAuthorCoordinates(page);
      await page.getByLabel('经度', { exact: true }).fill('1e+');
      await page.getByRole('button', { name: '手动新增地点', exact: true }).click();
      await page.getByLabel('地点名称').fill('未确认的名称');
      await page.getByLabel('经度', { exact: true }).fill('2e+');
      await expect(page.locator('[data-map] .amap-marker')).toHaveCount(2);
      const dialog = page.waitForEvent('dialog');
      const mapClick = page.locator('[data-map]').click({ position: { x: 8, y: 8 } });
      await (await dialog).dismiss();
      await mapClick;
      await expect(page.getByLabel('地点名称')).toHaveValue('未确认的名称');
      await expect(page.getByLabel('经度', { exact: true })).toHaveValue('2e+');
      await page.getByRole('button', { name: '放弃新增地点', exact: true }).click();
      await expect(page.getByLabel('经度', { exact: true })).toHaveValue('120.001');
      // The committed p0 input still blocks export although the discarded candidate is gone.
      await expect(page.locator('[data-copy]')).toBeDisabled();
      await page.locator('[data-point-id=p0] [data-select]').click();
      await expect(page.getByLabel('经度', { exact: true })).toHaveValue('1e+');
      await page.getByLabel('经度', { exact: true }).fill('120');
      await expect(page.locator('[data-copy]')).toBeEnabled();
      const exported = parse((await page.locator('[data-yaml]').textContent())!);
      expect(exported.map.points).toHaveLength(2);
      expect(exported.map.representative).toBe('p1');
      expect(exported.map.route).toEqual(['p0', 'p1', 'p0']);
      await expect(page.getByRole('button', { name: '放弃新增地点', exact: true })).toBeHidden();
    });

    test('separates places from repeated route stops and keeps a bounded export footer', async ({
      page,
      editorUrl,
    }, testInfo) => {
      void editorUrl;
      await importMap(page);
      await expect(page.getByRole('tab', { name: /^地点/ })).toHaveText('地点 2');
      await expect(page.getByRole('tab', { name: /^线路/ })).toHaveText('线路 3站');
      await expect(page.locator('[data-point-id=p1] [data-representative-badge]')).toBeVisible();
      await expect(page.locator('[data-point-id=p0] [data-representative-badge]')).toBeHidden();
      await showPlaceActions(page, 'p1');
      await page.locator('[data-point-id=p1] [data-up]').click();
      await expect(page.locator('[data-point-id]').first()).toHaveAttribute('data-point-id', 'p1');
      const initial = parse((await page.locator('[data-yaml]').textContent())!);
      expect(initial.map.route).toEqual(['p0', 'p1', 'p0']);
      expect(initial.map.representative).toBe('p1');
      await showAuthorTab(page, 'route');
      await expect(page.locator('[data-route-index="0"]')).toContainText('起点');
      await expect(page.locator('[data-route-index="2"]')).toContainText('终点');
      await expect(page.locator('[data-route-index="2"]')).toContainText('再次途经');
      await page.locator('[data-route-index="2"] [data-remove]').click();
      await expect(page.getByRole('tab', { name: /^线路/ })).toHaveText('线路 2站');
      const reduced = parse((await page.locator('[data-yaml]').textContent())!);
      expect(reduced.map.route).toEqual(['p0', 'p1']);
      expect(reduced.map.points).toHaveLength(2);
      expect(reduced.map.representative).toBe('p1');
      const layout = await page.evaluate(() => {
        const rect = (selector: string) =>
          document.querySelector(selector)!.getBoundingClientRect();
        const editor = rect('.editor-panel');
        const footer = rect('[data-export]');
        const scroll = rect('[data-editor-scroll]');
        const copy = rect('[data-copy]');
        return {
          bounded: footer.top >= editor.top && footer.bottom <= editor.bottom,
          separate: scroll.bottom <= footer.top + 1,
          copyVisible: copy.top >= footer.top && copy.bottom <= footer.bottom,
        };
      });
      expect(layout).toEqual({ bounded: true, separate: true, copyVisible: true });
      await expect(page.locator('[data-copy]')).toBeEnabled();
      await page.locator('.editor-panel').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('author-workspace.png'), fullPage: true });
    });

    test('preserves tab keyboard semantics, invalid inputs and exact remount focus', async ({
      page,
      editorUrl,
    }) => {
      void editorUrl;
      await importMap(page);
      await showAuthorCoordinates(page);
      await page.getByLabel('经度', { exact: true }).fill('1e+');
      await page.getByLabel('文章缩放（可选，新增值 2–20）').fill('2e+');
      await page.getByRole('tab', { name: /^地点/ }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name: /^线路/ })).toBeFocused();
      await expect(page.getByRole('tab', { name: /^线路/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.locator('[data-route-index="2"] [data-remove]').focus();
      await remount(page);
      await expect(page.locator('[data-route-index="2"] [data-remove]')).toBeFocused();
      await expect(page.getByRole('tab', { name: /^线路/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.locator('[data-copy]')).toBeDisabled();
      await showAuthorTab(page, 'places');
      await expect(page.getByLabel('经度', { exact: true })).toHaveValue('1e+');
      await expect(page.getByLabel('文章缩放（可选，新增值 2–20）')).toHaveValue('2e+');
      await showPlaceActions(page, 'p1');
      await page.locator('[data-point-id=p1] [data-up]').focus();
      await remount(page);
      await expect(page.locator('[data-point-id=p1] [data-up]')).toBeFocused();
      await expect(page.locator('[data-point-id=p1] .place-more')).toHaveAttribute('open', '');
    });

    test('reveals the name editor from a long list and map selection without adding a candidate', async ({
      page,
      editorUrl,
    }) => {
      void editorUrl;
      await importMap(page, 200);
      await showPlaceActions(page, 'p199');
      await page.locator('[data-point-id=p199] [data-up]').focus();
      await remount(page);
      await expect(page.locator('[data-point-id=p199] [data-up]')).toBeFocused();
      const restoredAction = await page
        .locator('[data-point-id=p199] [data-up]')
        .evaluate((control) => {
          const editor = document.querySelector('[data-editor-scroll]')!;
          const viewport = editor.getBoundingClientRect();
          const bounds = control.getBoundingClientRect();
          return {
            visible: bounds.top >= viewport.top && bounds.bottom <= viewport.bottom,
            top: bounds.top,
            bottom: bounds.bottom,
            viewportTop: viewport.top,
            viewportBottom: viewport.bottom,
            scrollTop: editor.scrollTop,
          };
        });
      expect(restoredAction.visible, JSON.stringify(restoredAction)).toBe(true);
      await page.locator('[data-point-id=p199] [data-select]').click();
      await expect(page.getByLabel('地点名称')).toHaveValue('地点 199');
      await nameIsInEditor(page);
      await page.locator('[data-point-id=p199]').scrollIntoViewIfNeeded();
      expect(
        await page.locator('[data-editor-scroll]').evaluate((element) => element.scrollTop),
      ).toBeGreaterThan(0);
      await page.evaluate(() => {
        const map = Reflect.get(window, '__hpmSdk').maps.at(-1);
        map.emit('click', {
          lnglat: { getLng: () => 118.798034, getLat: () => 31.968763 },
          originEvent: new MouseEvent('click'),
        });
      });
      await nameIsInEditor(page);
      await expect(page.locator('[data-point-id]')).toHaveCount(200);
      await expect(page.getByRole('button', { name: '确认添加地点', exact: true })).toBeVisible();
      await expect(page.locator('[data-copy]')).toBeDisabled();
      await showAuthorTab(page, 'route');
      await expect(page.locator('[data-route-index]')).toHaveCount(3);
      await showAuthorTab(page, 'places');
      await showAuthorCoordinates(page);
      await expect(page.getByLabel('经度', { exact: true })).toHaveValue('118.798034');
      await expect(page.getByLabel('纬度', { exact: true })).toHaveValue('31.968763');
    });
  });
}
