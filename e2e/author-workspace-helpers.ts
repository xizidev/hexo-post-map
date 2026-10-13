import type { Page } from 'playwright/test';

export async function showAuthorTab(page: Page, tab: 'places' | 'route') {
  await page.getByRole('tab', { name: tab === 'places' ? /^地点/u : /^线路/u }).click();
}

export async function showAuthorCoordinates(page: Page) {
  await showAuthorTab(page, 'places');
  const details = page.locator('[data-coordinate-details]');
  if ((await details.getAttribute('open')) === null)
    await details.getByText('坐标与地图设置', { exact: true }).click();
}

export async function showPlaceActions(page: Page, id: string) {
  await showAuthorTab(page, 'places');
  // IDs here are controlled test-fixture IDs, not imported source text.
  const details = page.locator(`[data-point-id="${id}"] .place-more`);
  if ((await details.getAttribute('open')) === null)
    await details.getByText('地点排序与删除', { exact: true }).click();
}
