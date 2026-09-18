import { test, expect } from './fixtures';

for (const width of [1440, 390]) {
  test(`leaf coordinate is at the painted dot center at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/blog/map/');
    await page.getByRole('button', { name: '查看此处的 4 篇文章' }).click();
    await expect(page.locator('.hpm-image-marker').first()).toBeVisible();
    const errors = await page.evaluate(() => {
      const markers = Reflect.get(window, '__hpmSdk').maps[0].cluster.markers;
      return markers
        .filter((item: { content: HTMLElement }) => item.content.matches('.hpm-image-marker'))
        .map((item: { content: HTMLElement; offset: { x: number; y: number } }) => {
          const box = item.content.getBoundingClientRect();
          const dot = item.content.querySelector('.hpm-image-marker__dot')!.getBoundingClientRect();
          return {
            x: dot.x + dot.width / 2 - box.x + item.offset.x,
            y: dot.y + dot.height / 2 - box.y + item.offset.y,
          };
        });
    });
    for (const error of errors) {
      expect(Math.abs(error.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(error.y)).toBeLessThanOrEqual(0.5);
    }
  });

  test(`initial and expanded fit reserve full leaf height at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/blog/map/');
    await page.getByRole('button', { name: '查看此处的 4 篇文章' }).click();
    const geometry = await page.evaluate(() => {
      const sdkMap = Reflect.get(window, '__hpmSdk').maps[0];
      const leaf = document.querySelector('.hpm-image-marker')!;
      const box = leaf.getBoundingClientRect();
      const dot = leaf.querySelector('.hpm-image-marker__dot')!.getBoundingClientRect();
      return {
        fits: sdkMap.boundsPadding,
        topExtent: dot.y + dot.height / 2 - box.y,
        halfWidth: box.width / 2,
        bottomExtent: box.bottom - dot.y - dot.height / 2,
      };
    });
    expect(geometry.fits).toHaveLength(2);
    for (const padding of geometry.fits) {
      expect(padding[0]).toBeGreaterThanOrEqual(geometry.topExtent + 32);
      expect(padding[1]).toBeGreaterThanOrEqual(geometry.bottomExtent + 16);
      expect(padding[2]).toBeGreaterThanOrEqual(geometry.halfWidth + 8);
      expect(padding[3]).toBeGreaterThanOrEqual(geometry.halfWidth + 8);
    }
  });
}

for (const count of [2, 10, 100]) {
  test(`cluster ${count} remains centered inside its 44px target`, async ({ page }) => {
    await page.route('**/map/posts.json', (route) =>
      route.fulfill({
        json: {
          version: 1,
          posts: Array.from({ length: count }, (_, index) => ({
            title: `Article ${index}`,
            url: `/blog/posts/${index}/`,
            image: '/blog/hexo-post-map/assets/placeholder.svg',
            date: '2025-05-01T00:00:00Z',
            location: { name: 'Shanghai', longitude: 121, latitude: 31 },
          })),
        },
      }),
    );
    await page.goto('/blog/map/');
    const button = page.locator('.hpm-cluster');
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    const surface = (await button.locator('.hpm-cluster__surface').boundingBox())!;
    expect(box.width).toBe(44);
    expect(box.height).toBe(44);
    expect(surface.width).toBe(count === 100 ? 42 : count === 10 ? 38 : 34);
    expect(Math.abs(surface.x + surface.width / 2 - box.x - box.width / 2)).toBeLessThanOrEqual(
      0.5,
    );
    expect(Math.abs(surface.y + surface.height / 2 - box.y - box.height / 2)).toBeLessThanOrEqual(
      0.5,
    );
    expect(surface.x).toBeGreaterThanOrEqual(box.x);
    expect(surface.x + surface.width).toBeLessThanOrEqual(box.x + box.width);
  });
}

test('light cluster text exceeds 4.5 contrast after alpha compositing over a white map', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/blog/map/');
  const surface = page.locator('.hpm-cluster__surface');
  await expect(surface).toBeVisible();
  const ratio = await surface.evaluate((element) => {
    const style = getComputedStyle(element);
    const parse = (color: string) => color.match(/[\d.]+/g)!.map(Number);
    const background = parse(style.backgroundColor);
    const foreground = parse(style.color);
    const alpha = background[3] ?? 1;
    const luminance = (rgb: number[]) =>
      rgb
        .slice(0, 3)
        .map((value) => {
          const s = value / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
    const bg = luminance(background.slice(0, 3).map((value) => value * alpha + 255 * (1 - alpha)));
    const fg = luminance(foreground);
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});
