import { test, expect } from './author-fixtures';
import { parse } from 'yaml';
import { showAuthorCoordinates } from './author-workspace-helpers';

// Author session traces stay off even when reader CI retains failure traces.
test.use({ trace: 'off' });

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}×${viewport.height} packed author search`, () => {
    test.use({ viewport });
    test('searches explicitly, scrolls results and adds only a confirmed named candidate', async ({
      page,
      editorUrl,
    }) => {
      void editorUrl;
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, '__authorSearchCalls')?.length))
        .toBe(0);
      await page.getByLabel('地点名称', { exact: true }).fill('Original');
      await showAuthorCoordinates(page);
      await page.getByLabel('经度', { exact: true }).fill('120');
      await page.getByLabel('纬度', { exact: true }).fill('30');
      await page.getByRole('button', { name: '确认添加地点' }).click();
      await page.getByRole('searchbox', { name: '搜索地点', exact: true }).fill('南京南站');
      await page.getByLabel('城市（可选）').fill('南京');
      expect(await page.evaluate(() => Reflect.get(window, '__authorSearchCalls').length)).toBe(0);
      await page.getByRole('searchbox', { name: '搜索地点', exact: true }).press('Enter');
      const results = page.getByRole('list', { name: '地点搜索结果' });
      await expect(results.getByRole('button')).toHaveCount(10);
      expect(
        await results.evaluate(
          (element) =>
            element.scrollHeight > element.clientHeight &&
            getComputedStyle(element).overflowY === 'auto',
        ),
      ).toBe(true);
      await results.getByRole('button').last().scrollIntoViewIfNeeded();
      expect(await results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await results.getByRole('button').first().focus();
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('地点名称', { exact: true })).toBeFocused();
      await expect(page.getByLabel('地点名称', { exact: true })).toBeInViewport();
      await expect(page.getByLabel('地点名称', { exact: true })).toHaveValue('南京南站');
      await expect(page.getByLabel('经度', { exact: true })).toHaveValue('118.79687712345');
      await expect(page.locator('[data-point-id]')).toHaveCount(1);
      expect(
        await page.evaluate(() => {
          const map = Reflect.get(window, '__hpmSdk').maps.at(-1);
          return {
            center: map.center,
            zoom: map.zoom,
            options: Reflect.get(window, '__authorSearchCalls')[0].options,
          };
        }),
      ).toMatchObject({
        center: [118.79687712345, 31.96867898765],
        zoom: 15,
        options: { city: '南京', citylimit: true },
      });
      await page.getByRole('button', { name: '确认添加地点' }).click();
      await expect(page.locator('[data-point-id]')).toHaveCount(2);
      const value = parse((await page.locator('[data-yaml]').textContent()) ?? '');
      expect(value.map.points[1]).toMatchObject({ name: '南京南站', longitude: 118.79687712345 });
      expect(value.map.representative).toBe('point-1');
      expect(value.map.zoom).toBeUndefined();
      expect(
        await page
          .locator('[data-author-root] button, [data-search-form] input')
          .evaluateAll((elements) =>
            elements
              .filter((element) => element.getClientRects().length)
              .every((element) => element.getBoundingClientRect().height >= 44),
          ),
      ).toBe(true);
    });
  });
}

test('late query ownership, empty results and quota failures preserve manual editing', async ({
  page,
  editorUrl,
}) => {
  void editorUrl;
  const keyword = page.getByRole('searchbox', { name: '搜索地点', exact: true });
  await keyword.fill('旧查询');
  await keyword.press('Enter');
  await expect(page.locator('[data-search-status]')).toContainText('正在搜索');
  await keyword.fill('外滩');
  await keyword.press('Enter');
  await expect(page.locator('[data-search-results]')).toContainText('外滩');
  await page.waitForTimeout(350);
  await expect(page.locator('[data-search-results]')).not.toContainText('旧查询');
  await keyword.fill('无结果');
  await keyword.press('Enter');
  await expect(page.locator('[data-search-status]')).toContainText('未找到');
  await expect(page.locator('[data-search-results]')).toBeHidden();
  await keyword.fill('额度受限');
  await keyword.press('Enter');
  await expect(page.locator('[data-search-status]')).toContainText('可继续');
  await page.getByLabel('地点名称', { exact: true }).fill('Manual');
  await showAuthorCoordinates(page);
  await page.getByLabel('经度', { exact: true }).fill('120');
  await page.getByLabel('纬度', { exact: true }).fill('30');
  await page.getByRole('button', { name: '确认添加地点' }).click();
  await expect(page.locator('[data-point-id]')).toHaveCount(1);
  await expect(page.locator('[data-copy]')).toBeEnabled();
});

test('cancelling candidate replacement retains pending input and search results', async ({
  page,
  editorUrl,
}) => {
  void editorUrl;
  await page.getByLabel('地点名称', { exact: true }).fill('尚未保存的备注');
  await showAuthorCoordinates(page);
  await page.getByLabel('经度', { exact: true }).fill('1e+');
  await page.getByLabel('纬度', { exact: true }).fill('30');
  await page.getByRole('searchbox', { name: '搜索地点', exact: true }).fill('南京南站');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  const result = page.locator('[data-search-result]').first();
  page.once('dialog', (dialog) => dialog.dismiss());
  await result.click();
  await expect(page.getByLabel('地点名称', { exact: true })).toHaveValue('尚未保存的备注');
  await expect(page.getByLabel('经度', { exact: true })).toHaveValue('1e+');
  await expect(page.locator('[data-copy]')).toBeDisabled();
  await expect(result).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await result.click();
  await expect(page.getByLabel('地点名称', { exact: true })).toHaveValue('南京南站');
  await expect(page.locator('[data-point-id]')).toHaveCount(0);
  await page.getByRole('button', { name: '确认添加地点' }).click();
  await expect(page.locator('[data-point-id]')).toHaveCount(1);
});

test('search result names remain inert text and lifecycle invalidates pending search', async ({
  page,
  editorUrl,
}) => {
  void editorUrl;
  const keyword = page.getByRole('searchbox', { name: '搜索地点', exact: true });
  await keyword.fill('<img src=x onerror=alert(1)>');
  await keyword.press('Enter');
  await expect(page.locator('[data-search-results]')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('[data-search-results] img')).toHaveCount(0);
  await keyword.fill('旧查询');
  await keyword.press('Enter');
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await page.waitForTimeout(350);
  await expect(page.locator('[data-search-result]')).toHaveCount(0);
  await expect(page.locator('[data-point-id]')).toHaveCount(0);
});
