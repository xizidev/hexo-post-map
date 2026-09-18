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
  }
  setFitView = vi.fn();
  setStatus = vi.fn();
  destroy = vi.fn();
}
class FakeMarker {
  constructor(readonly options: { position: number[]; content: HTMLElement }) {}
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
      markers.map((item) => [item.options.content.textContent, item.options.position]),
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
    expect(markers.map((marker) => marker.options.content.tagName)).toEqual([
      'SPAN',
      'SPAN',
      'SPAN',
    ]);
    expect(markers.map((marker) => marker.options.content.textContent)).toEqual(['1', '2', '']);
    expect(
      markers.every((marker) => marker.options.content.getAttribute('aria-hidden') === 'true'),
    ).toBe(true);
    expect(markers.every((marker) => marker.options.content.querySelector('a') === null)).toBe(
      true,
    );
    expect(
      markers.map(
        (marker) =>
          marker.options.content.querySelector('.hpm-detail-marker__label')?.textContent ?? '',
      ),
    ).toEqual(['1', '2', '']);
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
    expect(instance.setFitView).toHaveBeenCalledWith(markers, true, [44, 24, 24, 24]);
    handle.destroy();
  });

  it('keeps single-point pins silent and non-interactive when map interaction changes', async () => {
    const provider = await createAMapProvider(config);
    const pending = provider.mountDetail(document.createElement('div'), model());
    const marker = instance.overlays[0] as FakeMarker;
    const pin = marker.options.content;
    expect(pin.tagName).toBe('SPAN');
    expect(pin.className).toBe('hpm-detail-marker');
    expect(pin.textContent).toBe('');
    expect(pin.getAttribute('aria-hidden')).toBe('true');
    expect(pin.tabIndex).toBe(-1);
    expect(pin.querySelector('button, a, img')).toBe(null);
    const initial = pin.outerHTML;
    instance.emit('complete');
    const handle = await pending;
    handle.setInteractive(true);
    expect(instance.setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyboardEnable: true, dragEnable: true }),
    );
    expect(pin.outerHTML).toBe(initial);
    pin.click();
    expect(instance.destroy).not.toHaveBeenCalled();
    handle.setInteractive(false);
    expect(instance.setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyboardEnable: false, dragEnable: false }),
    );
    expect(pin.outerHTML).toBe(initial);
    handle.destroy();
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
    abort.abort();
    await expect(pending).rejects.toThrow();
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
