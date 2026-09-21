// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAMapProvider } from '../../src/browser/providers/amap';
import { normalizePostMap } from '../../src/domain/normalize';
import type { DetailMapModel } from '../../src/browser/providers/types';

const sdk = vi.hoisted(() => ({ load: vi.fn(), reset: vi.fn() }));
vi.mock('@amap/amap-jsapi-loader', () => ({ default: sdk }));
const config = { provider: 'amap' as const, amap: { key: 'key', serviceHost: '/proxy' } };
let instance: FakeMap;
class FakeMap {
  listeners = new Map<string, () => void>();
  overlays: unknown[] = [];
  constructor(
    readonly container: HTMLElement,
    readonly options: Record<string, unknown>,
  ) {
    // Expose the externally constructed SDK instance to drive deterministic vendor events.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    instance = this;
  }
  on(event: string, callback: () => void) {
    this.listeners.set(event, callback);
  }
  off(event: string) {
    this.listeners.delete(event);
  }
  emit(event: string) {
    this.listeners.get(event)?.();
  }
  add(overlays: unknown[]) {
    this.overlays.push(...overlays);
    overlays.forEach((overlay) => {
      if (overlay instanceof FakeMarker) this.container.append(overlay.options.content);
    });
  }
  setFitView = vi.fn();
  setStatus = vi.fn();
  destroy = vi.fn();
}
class FakeMarker {
  isTop = false;
  setTop = vi.fn((top: boolean) => {
    this.isTop = top;
  });
  constructor(readonly options: { position: number[]; content: HTMLElement }) {}
}
function markerButton(marker: FakeMarker): HTMLButtonElement {
  return marker.options.content.querySelector<HTMLButtonElement>('.hpm-detail-marker')!;
}
class FakePolyline {
  constructor(readonly options: { path: number[][] }) {}
}
function model(extra = {}): DetailMapModel {
  return {
    map: normalizePostMap(
      {
        points: [{ id: 'a', name: '<img onerror=alert(1)>', longitude: 121, latitude: 31 }],
        ...extra,
      },
      'test.md',
    )!,
    defaultZoom: 11,
  };
}
beforeEach(() => {
  sdk.load.mockReset().mockResolvedValue({
    Map: FakeMap,
    Marker: FakeMarker,
    Polyline: FakePolyline,
  });
  sdk.reset.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AMap adapter', () => {
  it('preserves every visit and numbered marker in an out-and-back route', async () => {
    const provider = await createAMapProvider(config);
    const pending = provider.mountDetail(
      document.createElement('div'),
      model({
        representative: 'a',
        points: [
          { id: 'a', name: 'A', longitude: 121, latitude: 31 },
          { id: 'b', name: 'B', longitude: 122, latitude: 32 },
          { id: 'c', name: 'Independent', longitude: 123, latitude: 33 },
        ],
        route: ['a', 'b', 'a'],
      }),
    );
    const markers = instance.overlays.filter(
      (item): item is FakeMarker => item instanceof FakeMarker,
    );
    expect(
      markers.map((item) => [
        markerButton(item).querySelector('.hpm-detail-marker__label')?.textContent ?? '',
        item.options.position,
      ]),
    ).toEqual([
      ['1', [121, 31]],
      ['2', [122, 32]],
      ['3', [121, 31]],
      ['', [123, 33]],
    ]);
    expect(
      (instance.overlays.find((item) => item instanceof FakePolyline) as FakePolyline).options.path,
    ).toEqual([
      [121, 31],
      [122, 32],
      [121, 31],
    ]);
    instance.emit('complete');
    (await pending).destroy();
  });
  it('honors reduced motion for map animations', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const provider = await createAMapProvider(config);
    const pending = provider.mountDetail(document.createElement('div'), model());
    expect(instance.options.animateEnable).toBe(false);
    instance.emit('complete');
    (await pending).destroy();
  });
  it.each([{ serviceHost: '/proxy' }, { securityJsCode: 'code' }])(
    'sets only the selected security mode before loading API 2.0 (%j)',
    async (security) => {
      sdk.load.mockImplementation(async (options) => {
        expect((window as unknown as { _AMapSecurityConfig: unknown })._AMapSecurityConfig).toEqual(
          security,
        );
        expect(options).toEqual({ key: 'key', version: '2.0' });
        return {};
      });
      await createAMapProvider({ provider: 'amap', amap: { key: 'key', ...security } });
    },
  );

  it('resets the third-party failed loader so a later attempt can actually retry', async () => {
    sdk.load.mockRejectedValueOnce(new Error('network'));
    await expect(createAMapProvider(config)).rejects.toThrow('network');
    expect(sdk.reset).toHaveBeenCalledTimes(1);
    await expect(createAMapProvider(config)).resolves.toHaveProperty('mountDetail');
  });

  it.each([{ zoom: 14, expected: 14 }, { expected: 11 }])(
    'uses authored or default zoom for a single point (%j)',
    async ({ zoom, expected }) => {
      const provider = await createAMapProvider(config);
      const pending = provider.mountDetail(
        document.createElement('div'),
        model(zoom ? { zoom } : {}),
      );
      expect(instance.options).toMatchObject({
        center: [121, 31],
        zoom: expected,
        scrollWheel: false,
        touchZoom: false,
        dragEnable: false,
        keyboardEnable: false,
      });
      expect(instance.setFitView).not.toHaveBeenCalled();
      instance.emit('complete');
      const handle = await pending;
      handle.setInteractive(true);
      expect(instance.setStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ scrollWheel: true, touchZoom: true, dragEnable: true }),
      );
      handle.destroy();
      handle.destroy();
      expect(instance.destroy).toHaveBeenCalledTimes(1);
      expect(instance.listeners.size).toBe(0);
    },
  );

  it('fits every marker and follows route order without including independent points', async () => {
    const provider = await createAMapProvider(config);
    const data = model({
      representative: 'b',
      points: [
        { id: 'a', name: 'A', longitude: 121, latitude: 31 },
        { id: 'b', name: 'B', longitude: 122, latitude: 32 },
        { id: 'c', name: 'C', longitude: 123, latitude: 33 },
      ],
      route: ['b', 'a'],
    });
    const pending = provider.mountDetail(document.createElement('div'), data);
    const markers = instance.overlays.filter(
      (overlay): overlay is FakeMarker => overlay instanceof FakeMarker,
    );
    expect(markers.map((marker) => marker.options.position)).toEqual([
      [122, 32],
      [121, 31],
      [123, 33],
    ]);
    expect(markers.map((marker) => marker.options.content.tagName)).toEqual(['DIV', 'DIV', 'DIV']);
    expect(markers.map((marker) => markerButton(marker).tagName)).toEqual([
      'BUTTON',
      'BUTTON',
      'BUTTON',
    ]);
    expect(markers.map((marker) => markerButton(marker).getAttribute('aria-label'))).toEqual([
      '显示地点 1：B',
      '显示地点 2：A',
      '显示地点：C',
    ]);
    expect(
      markers.every((marker) => markerButton(marker).getAttribute('aria-expanded') === 'false'),
    ).toBe(true);
    expect(markers.every((marker) => markerButton(marker).querySelector('a') === null)).toBe(true);
    expect(
      markers.map(
        (marker) =>
          markerButton(marker).querySelector('.hpm-detail-marker__label')?.textContent ?? '',
      ),
    ).toEqual(['1', '2', '']);
    expect(
      markers.map((marker) => ({
        viewBox: markerButton(marker).querySelector('svg')?.getAttribute('viewBox'),
        shape: markerButton(marker).querySelectorAll('.hpm-detail-marker__shape').length,
        dot: markerButton(marker).querySelectorAll('.hpm-detail-marker__dot').length,
      })),
    ).toEqual([
      { viewBox: '0 0 30 38', shape: 1, dot: 0 },
      { viewBox: '0 0 30 38', shape: 1, dot: 0 },
      { viewBox: '0 0 30 38', shape: 1, dot: 1 },
    ]);
    const line = instance.overlays.find(
      (overlay) => overlay instanceof FakePolyline,
    ) as FakePolyline;
    expect(line.options.path).toEqual([
      [122, 32],
      [121, 31],
    ]);
    expect(line.options).toMatchObject({ strokeColor: '#0f766e', strokeWeight: 3 });
    instance.emit('complete');
    const handle = await pending;
    expect(instance.setFitView).toHaveBeenCalledWith(markers, true, [112, 24, 24, 24]);
    handle.destroy();
  });

  it('shows only one custom place tooltip and closes it through every supported interaction', async () => {
    const provider = await createAMapProvider(config);
    const container = document.createElement('div');
    document.body.append(container);
    const pending = provider.mountDetail(
      container,
      model({
        representative: 'a',
        points: [
          { id: 'a', name: 'First place', longitude: 121, latitude: 31 },
          { id: 'b', name: 'Second place', longitude: 122, latitude: 32 },
        ],
        route: ['a', 'b'],
      }),
    );
    const markers = instance.overlays.filter(
      (overlay): overlay is FakeMarker => overlay instanceof FakeMarker,
    );
    const [first, second] = markers.map(markerButton);
    const firstTooltip =
      markers[0]!.options.content.querySelector<HTMLElement>('[role="tooltip"]')!;
    const secondTooltip =
      markers[1]!.options.content.querySelector<HTMLElement>('[role="tooltip"]')!;

    expect(first!.tagName).toBe('BUTTON');
    expect(first!.className).toContain('hpm-detail-marker');
    expect(first!.getAttribute('aria-expanded')).toBe('false');
    first!.click();
    expect(markers[0]!.isTop).toBe(true);
    expect(markers[1]!.isTop).toBe(false);
    expect(first!.getAttribute('aria-expanded')).toBe('true');
    expect(first!.getAttribute('aria-describedby')).toBe(firstTooltip.id);
    expect(firstTooltip.hidden).toBe(false);

    second!.click();
    expect(markers[0]!.isTop).toBe(false);
    expect(markers[1]!.isTop).toBe(true);
    expect(first!.getAttribute('aria-expanded')).toBe('false');
    expect(first!.hasAttribute('aria-describedby')).toBe(false);
    expect(firstTooltip.hidden).toBe(true);
    expect(second!.getAttribute('aria-expanded')).toBe('true');
    expect(secondTooltip.hidden).toBe(false);

    second!.click();
    expect(markers[1]!.isTop).toBe(false);
    expect(second!.getAttribute('aria-expanded')).toBe('false');
    first!.click();
    instance.emit('click');
    expect(first!.getAttribute('aria-expanded')).toBe('false');
    expect(markers[0]!.isTop).toBe(false);

    first!.click();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(first!.getAttribute('aria-expanded')).toBe('false');
    expect(markers[0]!.isTop).toBe(false);
    first!.click();
    instance.emit('zoomstart');
    expect(first!.getAttribute('aria-expanded')).toBe('false');
    expect(markers[0]!.isTop).toBe(false);
    second!.click();
    expect(second!.getAttribute('aria-expanded')).toBe('true');

    const secondScroller = secondTooltip.querySelector<HTMLElement>('.hpm-detail-tooltip__scroll')!;
    Object.defineProperties(secondScroller, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 320 },
    });
    secondScroller.scrollTop = 0;
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(secondScroller.scrollTop).toBe(220);
    expect(secondTooltip.scrollTop).toBe(0);
    expect(second!.getAttribute('aria-expanded')).toBe('true');
    secondTooltip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    secondTooltip.click();
    expect(second!.getAttribute('aria-expanded')).toBe('true');

    second!.focus();
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(second!.getAttribute('aria-expanded')).toBe('false');
    expect(markers[1]!.isTop).toBe(false);
    expect(document.activeElement).toBe(second);

    instance.emit('complete');
    const handle = await pending;
    handle.setInteractive(true);
    expect(instance.setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyboardEnable: true, dragEnable: true }),
    );
    handle.destroy();
    expect(markers.every((marker) => marker.isTop === false)).toBe(true);
    first!.click();
    expect(first!.getAttribute('aria-expanded')).toBe('false');
    expect(instance.listeners.size).toBe(0);
    container.remove();
  });

  it('raises the active marker across mouse and keyboard-style clicks at identical coordinates', async () => {
    const provider = await createAMapProvider(config);
    const container = document.createElement('div');
    const pending = provider.mountDetail(
      container,
      model({
        representative: 'a',
        points: [
          { id: 'a', name: 'First visit', longitude: 121, latitude: 31 },
          { id: 'b', name: 'Second visit', longitude: 121, latitude: 31 },
        ],
        route: ['a', 'b'],
      }),
    );
    const markers = instance.overlays.filter(
      (overlay): overlay is FakeMarker => overlay instanceof FakeMarker,
    );
    const first = markerButton(markers[0]!);
    const second = markerButton(markers[1]!);

    first.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(markers.map((marker) => marker.isTop)).toEqual([true, false]);

    second.focus();
    second.click();
    expect(markers.map((marker) => marker.isTop)).toEqual([false, true]);

    instance.emit('complete');
    const handle = await pending;
    handle.destroy();
    expect(markers.map((marker) => marker.isTop)).toEqual([false, false]);
  });

  it('removes tooltip listeners when initialization fails', async () => {
    const provider = await createAMapProvider(config);
    const container = document.createElement('div');
    const pending = provider.mountDetail(container, model());
    const marker = instance.overlays[0] as FakeMarker;
    const pin = markerButton(marker);
    expect(pin.className).toBe('hpm-detail-marker');
    expect(pin.getAttribute('aria-expanded')).toBe('false');
    pin.click();
    expect(marker.isTop).toBe(true);
    instance.emit('error');
    await expect(pending).rejects.toThrow();
    pin.click();
    expect(pin.getAttribute('aria-expanded')).toBe('false');
    expect(marker.isTop).toBe(false);
    expect(instance.listeners.size).toBe(0);
  });

  it('uses the container route color for route strokes', async () => {
    const provider = await createAMapProvider(config);
    const container = document.createElement('div');
    container.style.setProperty('--hpm-route-color', '#a855f7');
    document.body.append(container);
    const pending = provider.mountDetail(
      container,
      model({
        representative: 'a',
        points: [
          { id: 'a', name: 'A', longitude: 121, latitude: 31 },
          { id: 'b', name: 'B', longitude: 122, latitude: 32 },
        ],
        route: ['b', 'a'],
      }),
    );
    const line = instance.overlays.find(
      (overlay) => overlay instanceof FakePolyline,
    ) as FakePolyline;
    expect(line.options).toMatchObject({ strokeColor: '#a855f7', strokeWeight: 3 });
    instance.emit('complete');
    (await pending).destroy();
    container.remove();
  });

  it('destroys a pending map on abort and rejects initialization', async () => {
    const provider = await createAMapProvider(config);
    const abort = new AbortController();
    const pending = provider.mountDetail(document.createElement('div'), {
      ...model(),
      signal: abort.signal,
    });
    const marker = instance.overlays[0] as FakeMarker;
    markerButton(marker).click();
    expect(marker.isTop).toBe(true);
    abort.abort();
    await expect(pending).rejects.toThrow();
    expect(marker.isTop).toBe(false);
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects initialization errors and reports later runtime errors without retaining a live map', async () => {
    const provider = await createAMapProvider(config);
    const failed = provider.mountDetail(document.createElement('div'), model());
    instance.emit('error');
    await expect(failed).rejects.toThrow();
    expect(instance.destroy).toHaveBeenCalledTimes(1);
    const onError = vi.fn();
    const pending = provider.mountDetail(document.createElement('div'), { ...model(), onError });
    instance.emit('complete');
    await pending;
    instance.emit('error');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  it('times out initialization when the API never emits complete', async () => {
    vi.useFakeTimers();
    const provider = await createAMapProvider(config);
    const pending = provider.mountDetail(document.createElement('div'), model());
    const rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });
});
