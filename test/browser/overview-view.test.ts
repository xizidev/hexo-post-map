// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAMapOverviewProvider } from '../../src/browser/providers/amap-overview';
import type { OverviewMapHandle, OverviewMapOptions } from '../../src/browser/providers/types';
import type { OverviewPost } from '../../src/templates/overview';
import type { OverviewView } from '../../src/browser/overview/exploration-types';

const sdk = vi.hoisted(() => ({ load: vi.fn(), reset: vi.fn() }));
vi.mock('@amap/amap-jsapi-loader', () => ({ default: sdk }));
const a: OverviewPost = {
  title: 'A',
  url: '/a/',
  image: '/a.jpg',
  date: '2026-01-01',
  location: { name: 'Shanghai', longitude: 121.491234, latitude: 31.241234 },
};
let map: FakeMap;
class FakeMap {
  listeners = new Map<string, () => void>();
  center = [121, 31];
  zoom = 6;
  zoomEnabled = false;
  constructor(
    _container: HTMLElement,
    readonly options: Record<string, unknown>,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    map = this;
    if (typeof options.zoom === 'number') this.zoom = options.zoom;
    if (Array.isArray(options.center)) this.center = [...options.center];
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
  getZoom() {
    return this.zoom;
  }
  getCenter() {
    return { getLng: () => this.center[0]!, getLat: () => this.center[1]! };
  }
  setZoomAndCenter = vi.fn((zoom: number, center: readonly number[], immediately: boolean) => {
    if (this.zoomEnabled) this.zoom = zoom;
    this.center = [...center];
    if (immediately) this.emit('moveend');
  });
  setZoom = vi.fn((zoom: number) => {
    this.zoom = zoom;
  });
  setBounds = vi.fn();
  setStatus = vi.fn((status: Record<string, boolean>) => {
    if (status.zoomEnable !== undefined) this.zoomEnabled = status.zoomEnable;
  });
  destroy = vi.fn();
}
const handles: OverviewMapHandle[] = [];
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
async function start(overrides: Partial<OverviewMapOptions> = {}, MapClass = FakeMap) {
  sdk.load.mockResolvedValue({
    Map: MapClass,
    Bounds: class {},
    Pixel: class {},
    MarkerCluster: class {
      setMap() {}
    },
  });
  const provider = await createAMapOverviewProvider({
    provider: 'amap',
    amap: { key: 'key', mapStyle: '', serviceHost: '/proxy' },
  });
  const onError = vi.fn();
  const mounted = provider.mountOverview(document.createElement('div'), {
    posts: [a],
    gridSize: 60,
    maxZoom: 18,
    placeholderUrl: '',
    onPostSelect: vi.fn(),
    onGroupSelect: vi.fn(),
    onError,
    ...overrides,
  });
  await flush();
  return { mounted, map, onError };
}
async function mountWithFakeSdk(overrides: Partial<OverviewMapOptions> = {}) {
  const state = await start(overrides);
  state.map.emit('complete');
  const handle = await state.mounted;
  handles.push(handle);
  return { ...state, handle };
}
afterEach(() => {
  handles.splice(0).forEach((handle) => handle.destroy());
  vi.restoreAllMocks();
});

describe('overview view checkpoints', () => {
  it('uses initial view instead of fitting posts', async () => {
    const { handle, map } = await mountWithFakeSdk({
      initialView: { center: [121.49, 31.24], zoom: 11 },
    });
    expect(handle.getView?.()).toEqual({ center: [121.49, 31.24], zoom: 11 });
    expect(map.setBounds).not.toHaveBeenCalled();
    expect(map.zoomEnabled).toBe(false);
  });
  it('copies SDK coordinates and restores a view while preserving inactive controls', async () => {
    const { handle, map } = await mountWithFakeSdk();
    handle.setView?.({ center: [120.5, 30.5], zoom: 12 }, { immediately: true });
    const saved = handle.getView?.();
    map.center[0] = 100;
    expect(saved).toEqual({ center: [120.5, 30.5], zoom: 12 });
    expect(map.setZoomAndCenter).toHaveBeenCalledWith(12, [120.5, 30.5], true);
    expect(map.zoomEnabled).toBe(false);
  });
  it('keeps original representative coordinates and accepts zoom bounds', async () => {
    const { handle, map } = await mountWithFakeSdk();
    handle.setInteractive(true);
    handle.focusPost?.(a, 18, { immediately: false });
    expect(handle.getView?.()).toEqual({ center: [121.491234, 31.241234], zoom: 18 });
    expect(map.setZoomAndCenter).toHaveBeenCalledWith(18, [121.491234, 31.241234], false);
    handle.focusPost?.(a, 2, { immediately: true });
    expect(handle.getView?.()?.zoom).toBe(2);
    expect(map.zoomEnabled).toBe(true);
  });
  it.each([
    { center: [NaN, 31], zoom: 11 },
    { center: [181, 31], zoom: 11 },
    { center: [121, -91], zoom: 11 },
    { center: [121, 31], zoom: Infinity },
    { center: [121, 31], zoom: 1 },
    { center: [121, 31], zoom: 19 },
  ])('rejects invalid view without changing the map: %j', async (invalid) => {
    const { handle, map } = await mountWithFakeSdk();
    expect(() =>
      handle.setView?.(
        { center: [invalid.center[0]!, invalid.center[1]!], zoom: invalid.zoom },
        { immediately: true },
      ),
    ).toThrow('Invalid overview view');
    expect(map.setZoomAndCenter).not.toHaveBeenCalled();
  });
  it('returns no checkpoint for malformed SDK coordinates', async () => {
    const { handle, map } = await mountWithFakeSdk();
    map.center = [Infinity, 31];
    expect(handle.getView?.()).toBeUndefined();
  });
  it('detaches moveend zoomend and subscribers on destroy', async () => {
    const { handle, map } = await mountWithFakeSdk();
    const listener = vi.fn();
    const detach = handle.onViewEnd?.(listener);
    map.emit('moveend');
    map.emit('zoomend');
    expect(listener).toHaveBeenCalledTimes(2);
    detach?.();
    map.emit('moveend');
    expect(listener).toHaveBeenCalledTimes(2);
    handle.onViewEnd?.(listener);
    const late = map.listeners.get('moveend');
    handle.destroy();
    late?.();
    map.emit('zoomend');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(map.listeners.size).toBe(0);
    expect(handle.getView?.()).toBeUndefined();
    handle.setView?.({ center: [120, 30], zoom: 11 }, { immediately: true });
    expect(map.setZoomAndCenter).not.toHaveBeenCalled();
  });
  it('ignores view callbacks before ready and after abort', async () => {
    const abort = new AbortController();
    const state = await start({ signal: abort.signal });
    state.map.emit('moveend');
    state.map.emit('zoomend');
    expect(state.map.listeners.has('moveend')).toBe(false);
    state.map.emit('complete');
    const handle = await state.mounted;
    handles.push(handle);
    const listener = vi.fn();
    handle.onViewEnd?.(listener);
    const late = state.map.listeners.get('zoomend');
    abort.abort();
    late?.();
    expect(listener).not.toHaveBeenCalled();
    expect(state.map.listeners.size).toBe(0);
  });
  it('cannot resolve a cancelled initialization through a late ready callback', async () => {
    const abort = new AbortController();
    const state = await start({ signal: abort.signal });
    const rejected = expect(state.mounted).rejects.toThrow('Map initialization cancelled');
    const lateReady = state.map.listeners.get('complete')!;
    abort.abort();
    lateReady();
    state.map.emit('moveend');
    await rejected;
    expect(state.map.listeners.size).toBe(0);
    expect(state.map.setBounds).not.toHaveBeenCalled();
  });
  it('rejects initial zoom outside the configured bounds before constructing the map', async () => {
    sdk.load.mockResolvedValue({ Map: FakeMap, MarkerCluster: class {}, Bounds: class {} });
    const provider = await createAMapOverviewProvider({
      provider: 'amap',
      amap: { key: 'key', mapStyle: '', serviceHost: '/proxy' },
    });
    await expect(
      provider.mountOverview(document.createElement('div'), {
        posts: [a],
        gridSize: 60,
        maxZoom: 10,
        initialView: { center: [121, 31], zoom: 11 },
        placeholderUrl: '',
        onPostSelect: vi.fn(),
        onGroupSelect: vi.fn(),
      }),
    ).rejects.toThrow('Invalid overview view');
  });
  it('rejects invalid representative coordinates before focusing a post', async () => {
    const { handle, map } = await mountWithFakeSdk();
    const invalid = { ...a, location: { ...a.location, latitude: NaN } };
    expect(() => handle.focusPost!(invalid, 11, { immediately: true })).toThrow(
      'Invalid overview view',
    );
    expect(map.setZoomAndCenter).not.toHaveBeenCalled();
  });
  it('rejects malformed runtime coordinate tuples with a safe validation error', async () => {
    const { handle, map } = await mountWithFakeSdk();
    for (const center of [null, [121, 31, 1]]) {
      expect(() =>
        handle.setView!({ center, zoom: 11 } as unknown as OverviewView, { immediately: true }),
      ).toThrow('Invalid overview view');
    }
    expect(map.setZoomAndCenter).not.toHaveBeenCalled();
  });
  it('does not attach view listeners when initial view setting emits an SDK error', async () => {
    const state = await start({ initialView: { center: [121, 31], zoom: 11 } });
    const rejected = expect(state.mounted).rejects.toThrow('Map initialization failed');
    state.map.setZoomAndCenter.mockImplementation(() => {
      state.map.emit('error');
    });
    state.map.emit('complete');
    await rejected;
    expect(state.map.listeners.size).toBe(0);
    expect(state.map.destroy).toHaveBeenCalledOnce();
  });
  it('rejects initialization safely if SDK view listener registration fails', async () => {
    const state = await start();
    const rejected = expect(state.mounted).rejects.toThrow('Map initialization failed');
    vi.spyOn(state.map, 'on').mockImplementation(() => {
      throw new Error('private SDK error');
    });
    state.map.emit('complete');
    await rejected;
    expect(state.onError).not.toHaveBeenCalled();
    expect(state.map.listeners.size).toBe(0);
  });
  it('falls back to ordinary fitting when SDK view capabilities are missing', async () => {
    class LegacyMap extends FakeMap {}
    Object.defineProperty(LegacyMap.prototype, 'getCenter', { value: undefined });
    const state = await start({ initialView: { center: [121.49, 31.24], zoom: 11 } }, LegacyMap);
    state.map.emit('complete');
    const handle = await state.mounted;
    handles.push(handle);
    expect(handle.getView).toBeUndefined();
    expect(handle.setView).toBeUndefined();
    expect(handle.focusPost).toBeUndefined();
    expect(handle.onViewEnd).toBeUndefined();
    expect(state.map.setBounds).toHaveBeenCalledOnce();
  });
  it('keeps fitting usable if the SDK cannot atomically set zoom and center', async () => {
    class ReadOnlyViewMap extends FakeMap {
      constructor(container: HTMLElement, options: Record<string, unknown>) {
        super(container, options);
        Reflect.deleteProperty(this, 'setZoomAndCenter');
      }
    }
    const state = await start({}, ReadOnlyViewMap);
    state.map.emit('complete');
    const handle = await state.mounted;
    handles.push(handle);
    expect(handle.getView).toBeUndefined();
    expect(handle.setView).toBeUndefined();
    expect(handle.onViewEnd).toBeUndefined();
    expect(state.map.setBounds).toHaveBeenCalledOnce();
  });
  it('reports SDK write failures without exposing raw vendor details', async () => {
    const { handle, map, onError } = await mountWithFakeSdk();
    map.setZoomAndCenter.mockImplementation(() => {
      throw new Error('secret SDK details');
    });
    expect(() =>
      handle.setView?.({ center: [121, 31], zoom: 11 }, { immediately: true }),
    ).not.toThrow();
    expect(onError).toHaveBeenCalledWith();
    expect(map.destroy).toHaveBeenCalledOnce();
  });
});
