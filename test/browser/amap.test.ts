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
class FakeInfoWindow {
  static latest: FakeInfoWindow;
  open = vi.fn();
  close = vi.fn();
  constructor(readonly options: { content: HTMLElement }) {
    FakeInfoWindow.latest = this;
  }
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
    InfoWindow: FakeInfoWindow,
  });
  sdk.reset.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AMap adapter', () => {
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
      [121, 31],
      [122, 32],
      [123, 33],
    ]);
    expect(markers.map((marker) => marker.options.content.textContent)).toEqual(['2', '1', 'C']);
    const line = instance.overlays.find(
      (overlay) => overlay instanceof FakePolyline,
    ) as FakePolyline;
    expect(line.options.path).toEqual([
      [122, 32],
      [121, 31],
    ]);
    instance.emit('complete');
    const handle = await pending;
    expect(instance.setFitView).toHaveBeenCalledWith(markers, true, [24, 24, 24, 24]);
    handle.destroy();
  });

  it('opens a safe place link through a keyboard-operable marker', async () => {
    const provider = await createAMapProvider(config);
    const pending = provider.mountDetail(document.createElement('div'), model());
    const marker = instance.overlays[0] as FakeMarker;
    const button = marker.options.content as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.querySelector('img')).toBe(null);
    instance.emit('complete');
    const handle = await pending;
    handle.setInteractive(true);
    button.click();
    const content = FakeInfoWindow.latest.options.content;
    expect(content.textContent).toContain('<img onerror=alert(1)>');
    expect(content.querySelector('img')).toBe(null);
    expect(content.querySelector('a')!.href).toContain('https://uri.amap.com/marker?');
    expect(new URL(content.querySelector('a')!.href).searchParams.get('position')).toBe('121,31');
    handle.destroy();
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
