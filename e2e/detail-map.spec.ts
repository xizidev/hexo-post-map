import type { Locator, Page } from 'playwright/test';
import { test, expect } from './fixtures';

async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let press = 0; press < 30; press++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  await expect(target).toBeFocused();
}

function tooltipFor(pin: Locator) {
  return pin.locator('..').getByRole('tooltip');
}

async function expectTooltipInsideCanvas(canvas: Locator, tooltip: Locator) {
  await expect(tooltip).toBeVisible();
  const [canvasBox, tooltipBox] = await Promise.all([canvas.boundingBox(), tooltip.boundingBox()]);
  expect(tooltipBox!.x).toBeGreaterThanOrEqual(canvasBox!.x);
  expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(canvasBox!.x + canvasBox!.width);
  expect(tooltipBox!.y).toBeGreaterThanOrEqual(canvasBox!.y);
  expect(tooltipBox!.y + tooltipBox!.height).toBeLessThanOrEqual(canvasBox!.y + canvasBox!.height);
}

async function expectTooltipArrowConnected(pin: Locator) {
  const shell = tooltipFor(pin);
  await expect(shell).toHaveCSS('overflow', 'visible');
  await expect(shell.locator('.hpm-detail-tooltip__scroll')).toHaveCSS('overflow', 'auto');
  await expect(shell.locator('.hpm-detail-tooltip__arrow')).toHaveCount(1);
  await expect(shell.locator('button, a, [tabindex]')).toHaveCount(0);
  const geometry = await pin.evaluate((element) => {
    const content = element.closest<HTMLElement>('.hpm-detail-marker-content')!;
    const tooltip = content.querySelector<HTMLElement>('[role="tooltip"]')!;
    const pinBounds = element.getBoundingClientRect();
    const tooltipBounds = tooltip.getBoundingClientRect();
    const arrowElement = tooltip.querySelector<HTMLElement>('.hpm-detail-tooltip__arrow')!;
    const arrowBounds = arrowElement.getBoundingClientRect();
    const arrow = getComputedStyle(arrowElement);
    const arrowCenter = arrowBounds.left + arrowBounds.width / 2;
    const below = content.classList.contains('hpm-detail-marker-content--tooltip-below');
    const outsideY = below ? tooltipBounds.top - 2 : tooltipBounds.bottom + 2;
    const arrowTransform = new DOMMatrix(arrow.transform);
    return {
      shell: tooltipBounds.toJSON(),
      arrow: arrowBounds.toJSON(),
      pin: pinBounds.toJSON(),
      protrudes: below
        ? arrowBounds.top < tooltipBounds.top
        : arrowBounds.bottom > tooltipBounds.bottom,
      paintedOutside: document.elementFromPoint(arrowCenter, outsideY) === arrowElement,
      horizontalDistance: Math.abs(arrowCenter - (pinBounds.left + pinBounds.width / 2)),
      verticalGap: below
        ? tooltipBounds.top - pinBounds.bottom
        : pinBounds.top - tooltipBounds.bottom,
      below,
      directionMatches: below
        ? arrowTransform.a < 0 && arrowTransform.b < 0
        : arrowTransform.a > 0 && arrowTransform.b > 0,
    };
  });
  expect(geometry.horizontalDistance).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.verticalGap - 6)).toBeLessThanOrEqual(1);
  expect(geometry.directionMatches).toBe(true);
  expect(geometry.protrudes).toBe(true);
  expect(geometry.paintedOutside).toBe(true);

  // Compare actual raster output outside the shell. A clipped arrow has identical
  // pixels with visibility on/off, even when its DOM rectangle looks correct.
  const arrow = shell.locator('.hpm-detail-tooltip__arrow');
  const [shellBox, arrowBox] = await Promise.all([shell.boundingBox(), arrow.boundingBox()]);
  const clip = {
    x: arrowBox!.x,
    y: geometry.below ? arrowBox!.y : shellBox!.y + shellBox!.height,
    width: arrowBox!.width,
    height: geometry.below
      ? shellBox!.y - arrowBox!.y
      : arrowBox!.y + arrowBox!.height - shellBox!.y - shellBox!.height,
  };
  const visiblePixels = await pin.page().screenshot({ clip });
  await arrow.evaluate((element) => {
    (element as HTMLElement).style.visibility = 'hidden';
  });
  const hiddenPixels = await pin.page().screenshot({ clip });
  await arrow.evaluate((element) => {
    (element as HTMLElement).style.removeProperty('visibility');
  });
  expect(visiblePixels.equals(hiddenPixels)).toBe(false);
  await test.info().attach('tooltip-arrow-geometry', {
    body: JSON.stringify(geometry, null, 2),
    contentType: 'application/json',
  });
  await test.info().attach('tooltip-arrow-painted-outside', {
    body: visiblePixels,
    contentType: 'image/png',
  });
}

async function expectTooltipScrolledToEnd(tooltip: Locator) {
  await expect
    .poll(() =>
      tooltip.evaluate(
        (element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
      ),
    )
    .toBe(true);
}

async function scrollTooltipToEndByTouch(page: Page, tooltip: Locator) {
  const box = (await tooltip.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  const startY = box.y + box.height - 12;
  const maximumGestureDistance = Math.max(1, box.height - 24);
  const totalDistance = await tooltip.evaluate(
    (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
  );
  const maximumGestures = Math.ceil((totalDistance + 1) / maximumGestureDistance) + 1;
  const x = box.x + box.width / 2;

  try {
    for (let gesture = 0; gesture < maximumGestures; gesture++) {
      const remainingDistance = await tooltip.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      );
      if (remainingDistance <= 1) return;

      const gestureDistance = Math.min(remainingDistance + 2, maximumGestureDistance);
      const moveCount = Math.ceil(gestureDistance / 80);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y: startY }],
      });
      for (let move = 1; move <= moveCount; move++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: startY - Math.min(move * 80, gestureDistance) }],
        });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
  } finally {
    await session.detach();
  }
}

test('detail stays unloaded offscreen and becomes interactive automatically near the viewport', async ({
  page,
  network,
}) => {
  await page.addInitScript(() =>
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        const root = document.querySelector<HTMLElement>('[data-hpm-detail]');
        if (root) root.style.marginTop = '200vh';
      },
      { once: true },
    ),
  );
  await page.goto('/blog/posts/single/');
  const root = page.locator('[data-hpm-detail]');
  await expect(root.locator('[data-hpm-activate]')).toHaveCount(0);
  expect(network.sdkRequests).toBe(0);
  await expect(root.locator('[data-hpm-fallback]')).toBeVisible();
  await root.scrollIntoViewIfNeeded();
  const pin = root.locator('.hpm-detail-marker');
  await expect(pin).toBeVisible();
  await expect(pin.locator('svg')).toHaveAttribute('viewBox', '0 0 30 38');
  await expect(pin.locator('.hpm-detail-marker__shape')).toHaveCount(1);
  await expect(pin.locator('.hpm-detail-marker__dot')).toHaveCount(1);
  await expect(pin.locator('.hpm-detail-marker__label')).toHaveCount(0);
  await expect(pin).toHaveAttribute('aria-label', '显示地点：Shanghai GCJ-02');
  await expect(pin).toHaveAttribute('aria-expanded', 'false');
  await expect(root.locator('[data-hpm-canvas]')).toHaveAttribute(
    'aria-label',
    '文章地点地图：Shanghai GCJ-02',
  );
  expect(network.sdkRequests).toBe(1);
  await expect(root.locator('[data-hpm-canvas]')).toHaveCSS('pointer-events', 'auto');
  await expect(root).toHaveAttribute('data-hpm-active', 'true');
  await expect(root.locator('[data-hpm-status]')).toBeEmpty();
  await expect(root.locator('[data-hpm-fallback]')).toBeHidden();
  await pin.click();
  const tooltip = root.getByRole('tooltip');
  await expect(tooltip).toHaveText('Shanghai GCJ-02');
  await expect(tooltip).toBeVisible();
  await expectTooltipArrowConnected(pin);
  await expect(pin).toHaveAttribute('aria-expanded', 'true');
  const tooltipId = await tooltip.getAttribute('id');
  expect(tooltipId).not.toBeNull();
  await expect(pin).toHaveAttribute('aria-describedby', tooltipId!);
  await expect(
    root.locator('[data-hpm-canvas] .amap-info-window, [data-hpm-canvas] a'),
  ).toHaveCount(0);
  await pin.click();
  await expect(tooltip).toBeHidden();
  await expect(pin).toHaveAttribute('aria-expanded', 'false');
  await expect(pin).not.toHaveAttribute('aria-describedby', /.+/u);
  await expect(root).toHaveAttribute('data-hpm-active', 'true');
});

test('route draws ordered coordinates and interactive numbered pins with accessible map names', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/blog/posts/route/');
  expect(
    await page.locator('[data-hpm-detail]').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        route: style.getPropertyValue('--hpm-route-color').trim(),
        text: style.getPropertyValue('--hpm-text').trim(),
        muted: style.getPropertyValue('--hpm-muted').trim(),
      };
    }),
  ).toEqual({ route: '#5eead4', text: '#e2e8f0', muted: '#94a3b8' });
  const pins = page.locator('.hpm-detail-marker');
  await expect(pins.locator('.hpm-detail-marker__label')).toHaveText(['1', '2', '3']);
  await expect(pins.locator('.hpm-detail-marker__shape')).toHaveCount(3);
  await expect(pins.locator('.hpm-detail-marker__dot')).toHaveCount(0);
  expect(
    await pins.evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        const svg = element.querySelector('svg')!.getBoundingClientRect();
        return {
          marker: [bounds.width, bounds.height],
          icon: [svg.width, svg.height],
        };
      }),
    ),
  ).toEqual([
    { marker: [44, 44], icon: [30, 38] },
    { marker: [44, 44], icon: [30, 38] },
    { marker: [44, 44], icon: [30, 38] },
  ]);
  // Bottom-anchored pins extend above their coordinates. The SDK fit
  // must reserve their full painted height, plus a small gap, above the bounds.
  expect(
    await page.evaluate(() => {
      const padding = Reflect.get(window, '__hpmSdk').maps[0].fitPadding;
      const height = Math.max(
        ...Array.from(document.querySelectorAll('.hpm-detail-marker')).map(
          (pin) => pin.getBoundingClientRect().height,
        ),
      );
      return padding[0] >= Math.ceil(height) + 64;
    }),
  ).toBe(true);
  await expect(page.locator('[data-hpm-canvas]')).toHaveAttribute(
    'aria-label',
    '文章地点地图：Summit GCJ-02、Visitor center GCJ-02、Cableway GCJ-02',
  );
  await expect(page.locator('[data-hpm-canvas] button')).toHaveCount(3);
  await expect(page.locator('[data-hpm-canvas] a, .amap-info-window')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, '__hpmSdk').paths)).toEqual([
    [
      [114.1501, 27.4682],
      [114.1623, 27.4741],
      [114.1735, 27.4568],
    ],
  ]);
});

test('route place tooltips switch across mouse and keyboard and close without losing focus', async ({
  page,
}) => {
  await page.goto('/blog/posts/route/');
  const canvas = page.locator('[data-hpm-canvas]');
  const pins = page.locator('.hpm-detail-marker');
  const first = pins.nth(0);
  const second = pins.nth(1);

  await first.click();
  await expect(tooltipFor(first)).toHaveText('1 · Visitor center GCJ-02');
  await expect(tooltipFor(first)).toBeVisible();
  await expect(first).toHaveAttribute('aria-expanded', 'true');

  await tabTo(page, second);
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(second).toHaveAttribute('aria-expanded', 'true');
  await expect(tooltipFor(second)).toHaveText('2 · Cableway GCJ-02');
  await expect(tooltipFor(second)).toBeVisible();
  const secondTooltipId = await tooltipFor(second).getAttribute('id');
  expect(secondTooltipId).not.toBeNull();
  await expect(second).toHaveAttribute('aria-describedby', secondTooltipId!);

  await page.keyboard.press('Escape');
  await expect(second).toHaveAttribute('aria-expanded', 'false');
  await expect(second).toBeFocused();
  await page.keyboard.press('Space');
  await expect(second).toHaveAttribute('aria-expanded', 'true');
  await canvas.click({ position: { x: 12, y: 12 } });
  await expect(second).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.amap-info-window, [data-hpm-canvas] a')).toHaveCount(0);
});

test('an identical-coordinate marker rises above its sibling for mouse and keyboard activation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Reflect.set(window, '__hpmSdkMarkerLayout', [
      { left: 'calc(50% - 22px)', top: 'calc(50% - 22px)' },
      { left: 'calc(50% - 22px)', top: 'calc(50% - 22px)' },
    ]);
  });
  await page.route('**/posts/route/', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /(<script type="application\/json" data-hpm-data>)([\s\S]*?)(<\/script>)/u,
      (_all, start, json, end) => {
        const data = JSON.parse(json);
        data.map.points[1].longitude = data.map.points[0].longitude;
        data.map.points[1].latitude = data.map.points[0].latitude;
        data.map.route[1].longitude = data.map.route[0].longitude;
        data.map.route[1].latitude = data.map.route[0].latitude;
        data.map.route = data.map.route.slice(0, 2);
        return start + JSON.stringify(data).replaceAll('<', '\\u003c') + end;
      },
    );
    await route.fulfill({ response, body });
  });
  await page.goto('/blog/posts/route/');
  const pins = page.locator('.hpm-detail-marker');
  const first = pins.nth(0);
  const second = pins.nth(1);

  await second.click();
  await expect(tooltipFor(second)).toBeVisible();
  expect(
    await second.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return document
        .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        ?.closest('button')
        ?.getAttribute('aria-label');
    }),
  ).toBe('显示地点 2：Cableway GCJ-02');

  await first.focus();
  await page.keyboard.press('Enter');
  await expect(tooltipFor(first)).toBeVisible();
  await expect(tooltipFor(second)).toBeHidden();
  expect(
    await first.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return document
        .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        ?.closest('button')
        ?.getAttribute('aria-label');
    }),
  ).toBe('显示地点 1：Visitor center GCJ-02');
});

test('place tooltip keeps readable contrast when a host theme overrides map text', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/blog/posts/single/');
  const root = page.locator('[data-hpm-detail]');
  await root.evaluate((element) =>
    (element as HTMLElement).style.setProperty('--hpm-text', '#c9cacc'),
  );
  await root.locator('.hpm-detail-marker').click();
  const contrast = await root.getByRole('tooltip').evaluate((element) => {
    const parse = (value: string) =>
      (value.match(/[\d.]+/gu) ?? []).map((component) => Number(component));
    const luminance = ([red, green, blue]: number[]) => {
      const channels = [red, green, blue].map((component = 0) => {
        const channel = component / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    };
    const style = getComputedStyle(element);
    const foreground = luminance(parse(style.color));
    const background = luminance(parse(style.backgroundColor));
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
});

for (const testCase of [
  { pageName: 'single', width: 1440, positions: [{ left: '0px', top: '0px' }] },
  { pageName: 'single', width: 390, positions: [{ left: 'calc(100% - 44px)', top: '0px' }] },
  {
    pageName: 'route',
    width: 1440,
    positions: [
      { left: '0px', top: '0px' },
      { left: 'calc(100% - 44px)', top: '0px' },
    ],
  },
  {
    pageName: 'route',
    width: 390,
    positions: [
      { left: '0px', top: '0px' },
      { left: 'calc(100% - 44px)', top: '0px' },
    ],
  },
]) {
  test(`long ${testCase.pageName} tooltips stay inside ${testCase.width}px canvas edges at 200% root text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: testCase.width, height: 900 });
    await page.addInitScript((positions) => {
      document.documentElement.style.fontSize = '32px';
      Reflect.set(window, '__hpmSdkMarkerLayout', positions);
    }, testCase.positions);
    await page.route(`**/posts/${testCase.pageName}/`, async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        /(<script type="application\/json" data-hpm-data>)([\s\S]*?)(<\/script>)/u,
        (_all, start, json, end) => {
          const data = JSON.parse(json);
          data.map.points[0].name =
            'A deliberately long place name near the canvas edge that must wrap and remain completely visible at two hundred percent root text size';
          if (data.map.route[0]) data.map.route[0].name = data.map.points[0].name;
          if (data.map.points[1]) {
            data.map.points[1].name =
              'A second deliberately long place name against the opposite edge that must also remain completely visible';
            if (data.map.route[1]) data.map.route[1].name = data.map.points[1].name;
          }
          return start + JSON.stringify(data).replaceAll('<', '\\u003c') + end;
        },
      );
      await route.fulfill({ response, body });
    });
    await page.goto(`/blog/posts/${testCase.pageName}/`);
    const canvas = page.locator('[data-hpm-canvas]');
    const pins = page.locator('.hpm-detail-marker');
    await pins.first().click();
    await expectTooltipInsideCanvas(canvas, tooltipFor(pins.first()));
    await expectTooltipArrowConnected(pins.first());

    if (testCase.pageName === 'single') {
      await pins.first().click();
      await pins.first().evaluate((element) => {
        const wrapper = element.closest<HTMLElement>('.amap-marker')!;
        wrapper.style.left = wrapper.style.left === '0px' ? 'calc(100% - 44px)' : '0px';
      });
      await pins.first().click();
      await expectTooltipInsideCanvas(canvas, tooltipFor(pins.first()));
      await expectTooltipArrowConnected(pins.first());
    } else {
      await pins.nth(1).click();
      await expectTooltipInsideCanvas(canvas, tooltipFor(pins.nth(1)));
      await expectTooltipArrowConnected(pins.nth(1));
    }
    await page.keyboard.press('Escape');
    await pins.first().evaluate((element) => {
      element.closest<HTMLElement>('.amap-marker')!.style.top = 'calc(100% - 44px)';
    });
    await pins.first().click();
    await expectTooltipInsideCanvas(canvas, tooltipFor(pins.first()));
    await expectTooltipArrowConnected(pins.first());
    await expect(pins.first().locator('..')).not.toHaveClass(/tooltip-below/u);
  });
}

test('an overflowing 200% tooltip is operable by mouse, touch and keyboard without losing Escape focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.addInitScript(() => {
    document.documentElement.style.fontSize = '32px';
    Reflect.set(window, '__hpmSdkMarkerLayout', [{ left: '0px', top: '0px' }]);
  });
  await page.route('**/posts/single/', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /(<script type="application\/json" data-hpm-data>)([\s\S]*?)(<\/script>)/u,
      (_all, start, json, end) => {
        const data = JSON.parse(json);
        data.map.points[0].name =
          'The beginning of an intentionally extreme place name. '.repeat(24) +
          'The final words must remain reachable.';
        return start + JSON.stringify(data).replaceAll('<', '\\u003c') + end;
      },
    );
    await route.fulfill({ response, body });
  });
  await page.goto('/blog/posts/single/');
  const pin = page.locator('.hpm-detail-marker');
  const tooltip = tooltipFor(pin);
  const scroller = tooltip.locator('.hpm-detail-tooltip__scroll');
  await pin.click();
  await expectTooltipArrowConnected(pin);
  expect(await scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );

  await scroller.hover();
  await page.mouse.wheel(0, 4000);
  expect(
    await scroller.evaluate((element) => ({
      atEnd: element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      pointerEvents: getComputedStyle(element).pointerEvents,
      overflowY: getComputedStyle(element).overflowY,
    })),
  ).toEqual(expect.objectContaining({ atEnd: true }));
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
  await expect(pin).toBeFocused();

  await pin.click();
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
  await scrollTooltipToEndByTouch(page, scroller);
  await expectTooltipScrolledToEnd(scroller);
  await expectTooltipArrowConnected(pin);
  await page.keyboard.press('Escape');
  await expect(pin).toBeFocused();

  await pin.click();
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
  await page.keyboard.press('ArrowDown');
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(40);
  await page.keyboard.press('ArrowUp');
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
  await page.keyboard.press('PageDown');
  expect(await scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('PageUp');
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
  await page.keyboard.press('End');
  await expectTooltipScrolledToEnd(scroller);
  await page.keyboard.press('Home');
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await tooltip.evaluate((element) => element.scrollTop)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
  await expect(pin).toBeFocused();
});

test('out-and-back route retains each visit label and its return segment', async ({ page }) => {
  await page.route('**/posts/route/', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /(<script type="application\/json" data-hpm-data>)([\s\S]*?)(<\/script>)/u,
      (_all, start, json, end) => {
        const data = JSON.parse(json);
        data.map.route = [data.map.points[0], data.map.points[1], data.map.points[0]];
        return start + JSON.stringify(data).replaceAll('<', '\\u003c') + end;
      },
    );
    await route.fulfill({ response, body });
  });
  await page.goto('/blog/posts/route/');
  await expect(page.locator('.hpm-detail-marker__label')).toHaveText(['1', '2', '3']);
  await expect(page.locator('.hpm-detail-marker')).toHaveCount(4);
  const path = await page.evaluate(() => Reflect.get(window, '__hpmSdk').paths[0]);
  expect(path).toHaveLength(3);
  expect(path[0]).toEqual(path[2]);
  expect(path[0]).not.toEqual(path[1]);
});

test('multi-point article fits its points without inventing a route', async ({ page }) => {
  await page.goto('/blog/posts/multi/');
  await expect(page.locator('[data-hpm-detail]')).toHaveAttribute('data-hpm-active', 'true');
  const pins = page.locator('.hpm-detail-marker');
  await expect(pins.locator('.hpm-detail-marker__label')).toHaveCount(0);
  await expect(pins.locator('.hpm-detail-marker__dot')).toHaveCount(2);
  expect(
    await page.evaluate(() => ({
      paths: Reflect.get(window, '__hpmSdk').paths,
      fitted: Reflect.get(window, '__hpmSdk').maps[0].fitted,
    })),
  ).toEqual({ paths: [], fitted: true });
});

test('SDK failure keeps place links and article readable', async ({ page }) => {
  await page.route('https://webapi.amap.com/**', (route) => route.abort());
  await page.goto('/blog/posts/single/');
  await expect(page.locator('[data-hpm-status]')).toContainText('无法加载');
  await expect(page.locator('[data-hpm-fallback]')).toBeVisible();
  await expect(page.locator('[data-hpm-fallback] a')).toContainText('Shanghai GCJ-02');
  await expect(page.getByText('Single-point article content.')).toBeVisible();
});

test('multiple detail maps reuse one SDK load and ordinary pages request none', async ({
  page,
  network,
}) => {
  await page.goto('/blog/posts/plain/');
  expect(network.sdkRequests).toBe(0);
  await expect(page.locator('[data-hpm-detail], script[src*="hexo-post-map"]')).toHaveCount(0);
  await page.route('**/posts/single/', async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    // Supply two server-rendered components before the published bundle hydrates them.
    const component = html.match(/<section class="hpm-detail"[\s\S]*?<\/section>/u)?.[0];
    expect(component).toBeTruthy();
    await route.fulfill({ response, body: html.replace(component!, component! + component!) });
  });
  await page.goto('/blog/posts/single/');
  await expect(page.locator('[data-hpm-activate]')).toHaveCount(0);
  await expect(page.locator('.hpm-detail-marker')).toHaveCount(2);
  await expect(page.locator('[data-hpm-detail][data-hpm-active="true"]')).toHaveCount(2);
  expect(network.sdkRequests).toBe(1);
});
