// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrateOverview, initializeOverviewMaps } from '../../src/browser/overview/index';
import { renderPostPanel } from '../../src/browser/overview/panel';
import { renderOverview, type OverviewPost } from '../../src/templates/overview';
import { resolveConfig } from '../../src/config/resolve';
import type { MapHandle, MapProvider, OverviewMapOptions } from '../../src/browser/providers/types';
import { createAMapProvider } from '../../src/browser/providers/amap';

const sdk = vi.hoisted(() => ({ load: vi.fn(), reset: vi.fn() }));
vi.mock('@amap/amap-jsapi-loader', () => ({ default: sdk }));

const config = resolveConfig(
  { enabled: true, amap: { key: 'key', security: { service_host: 'https://example.com/proxy' } } },
  {},
)!;
const a: OverviewPost = {
  title: '<img onerror=alert(1)>',
  url: '/blog/a/',
  image: '/blog/a.jpg',
  date: '2025-01-01T00:00:00Z',
  location: { name: '上海', longitude: 121, latitude: 31 },
};
const b: OverviewPost = { ...a, title: 'B', url: '/blog/b/', date: '2026-01-01T00:00:00Z' };
const flush = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture() {
  document.body.innerHTML = renderOverview({
    posts: [b, a],
    config,
    dataUrl: '/blog/map/posts.json',
    placeholderUrl: '/blog/assets/placeholder.svg',
  });
  return document.querySelector<HTMLElement>('[data-hpm-overview]')!;
}
function setup(data: unknown = { version: 1, posts: [a, b] }) {
  const root = fixture();
  const fetcher = vi.fn(async () => new Response(JSON.stringify(data)));
  const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
  const mountOverview = vi.fn<MapProvider['mountOverview']>(async () => handle);
  const load = vi.fn(async () => ({ mountDetail: vi.fn(), mountOverview }));
  const controller = hydrateOverview(root, load, fetcher);
  return { root, fetcher, handle, mountOverview, load, controller };
}
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

interface ClusterPoint {
  lnglat: number[];
  post: OverviewPost;
}
interface RenderContext {
  marker: ClusterMarker;
  clusterData?: ClusterPoint[];
  data?: ClusterPoint[];
}
interface ClusterOptions {
  gridSize: number;
  maxZoom: number;
  renderClusterMarker(context: RenderContext): void;
  renderMarker(context: RenderContext): void;
}
let mapInstance: OverviewFakeMap;
let clusterInstance: FakeCluster;
class OverviewFakeMap {
  listeners = new Map<string, () => void>();
  zoom = 6;
  constructor(
    readonly container: HTMLElement,
    readonly options: Record<string, unknown>,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    mapInstance = this;
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
  setBounds = vi.fn();
  setStatus = vi.fn();
  destroy = vi.fn();
}
class ClusterMarker {
  content: HTMLElement | undefined;
  setContent(content: HTMLElement) {
    this.content = content;
  }
  setOffset() {}
}
class FakeBounds {
  constructor(
    readonly southwest: number[],
    readonly northeast: number[],
  ) {}
}
class FakeCluster {
  setMap = vi.fn();
  constructor(
    readonly map: OverviewFakeMap,
    readonly data: ClusterPoint[],
    readonly options: ClusterOptions,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    clusterInstance = this;
  }
}
async function adapter(plugin?: (names: string[], ready: () => void) => void) {
  const api = {
    Map: OverviewFakeMap,
    MarkerCluster: FakeCluster,
    Bounds: FakeBounds,
    Pixel: class {},
    plugin,
  };
  if (plugin) Reflect.deleteProperty(api, 'MarkerCluster');
  sdk.load.mockResolvedValue(api);
  return createAMapProvider({ provider: 'amap', amap: { key: 'key', serviceHost: '/proxy' } });
}
function overviewOptions(overrides: Partial<OverviewMapOptions> = {}): OverviewMapOptions {
  return {
    posts: [a, b],
    gridSize: 72,
    maxZoom: 18,
    placeholderUrl: '/placeholder.svg',
    onPostSelect: vi.fn(),
    onGroupSelect: vi.fn(),
    ...overrides,
  };
}
describe('AMap overview clustering boundary', () => {
  it('configures pixel clustering, fits all unchanged coordinates and renders accessible leaf images', async () => {
    const provider = await adapter();
    const options = overviewOptions({
      posts: [a, { ...b, location: { name: 'B', longitude: 122, latitude: 32 } }],
    });
    const before = JSON.stringify(options.posts);
    const pending = provider.mountOverview(document.createElement('div'), options);
    await flush();
    expect(clusterInstance.options).toMatchObject({ gridSize: 72, maxZoom: 18 });
    expect(mapInstance.options).toMatchObject({
      zooms: [3, 18],
      scrollWheel: false,
      touchZoom: false,
    });
    expect(clusterInstance.data.map((point) => point.lnglat)).toEqual([
      [121, 31],
      [122, 32],
    ]);
    const marker = new ClusterMarker();
    clusterInstance.options.renderMarker({ marker, data: [clusterInstance.data[0]!] });
    const button = marker.content as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-label')).toContain(a.title);
    expect(button.querySelector('img')!.width).toBe(96);
    mapInstance.emit('complete');
    const handle = await pending;
    expect(mapInstance.setBounds).toHaveBeenCalledWith(
      expect.objectContaining({ southwest: [121, 31], northeast: [122, 32] }),
      true,
      [48, 48, 48, 48],
    );
    handle.setInteractive(true);
    button.click();
    expect(options.onPostSelect).toHaveBeenCalledWith(a, button);
    expect(JSON.stringify(options.posts)).toBe(before);
    handle.destroy();
    handle.destroy();
    expect(mapInstance.destroy).toHaveBeenCalledTimes(1);
    expect(clusterInstance.setMap).toHaveBeenCalledWith(null);
    button.click();
    expect(options.onPostSelect).toHaveBeenCalledTimes(1);
  });
  it.each(['separable', 'maximum', 'identical'])(
    'handles a %s cluster through the pure decision',
    async (kind) => {
      const provider = await adapter();
      const options = overviewOptions({
        posts: [
          a,
          kind === 'identical'
            ? b
            : { ...b, location: { name: 'B', longitude: 122, latitude: 32 } },
        ],
      });
      const pending = provider.mountOverview(document.createElement('div'), options);
      await flush();
      mapInstance.emit('complete');
      const handle = await pending;
      handle.setInteractive(true);
      const marker = new ClusterMarker();
      clusterInstance.options.renderClusterMarker({ marker, clusterData: clusterInstance.data });
      const button = marker.content as HTMLButtonElement;
      expect(button.textContent).toBe('2');
      expect(button.getAttribute('aria-label')).toContain('2');
      mapInstance.setBounds.mockClear();
      mapInstance.zoom = kind === 'maximum' ? 18 : 6;
      button.click();
      if (kind === 'separable') {
        expect(mapInstance.setBounds).toHaveBeenCalledTimes(1);
        expect(options.onGroupSelect).not.toHaveBeenCalled();
      } else {
        expect(mapInstance.setBounds).not.toHaveBeenCalled();
        expect(options.onGroupSelect).toHaveBeenCalledWith([options.posts[1], a], button);
      }
      handle.destroy();
    },
  );
  it('cleans a failed map, and reports errors after readiness', async () => {
    const provider = await adapter();
    const onError = vi.fn();
    const pending = provider.mountOverview(
      document.createElement('div'),
      overviewOptions({ onError }),
    );
    await flush();
    mapInstance.emit('complete');
    await pending;
    mapInstance.emit('error');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(mapInstance.destroy).toHaveBeenCalledTimes(1);
    expect(mapInstance.listeners.size).toBe(0);
  });
  it('aborts pending plugin loading without constructing a late map', async () => {
    let ready!: () => void;
    const provider = await adapter((_names, callback) => {
      ready = callback;
    });
    const abort = new AbortController();
    const previous = mapInstance;
    const pending = provider.mountOverview(
      document.createElement('div'),
      overviewOptions({ signal: abort.signal }),
    );
    const rejected = expect(pending).rejects.toThrow();
    await flush();
    abort.abort();
    await rejected;
    ready();
    await flush();
    expect(mapInstance).toBe(previous);
  });
});

describe('article panels', () => {
  it.each(['desktop', 'mobile'] as const)(
    'renders safe newest-first %s results with links, close and focus restoration',
    (viewport) => {
      const origin = document.createElement('button');
      document.body.append(origin);
      origin.focus();
      const panel = renderPostPanel([a, b], viewport, {
        container: document.body,
        placeholderUrl: '/placeholder.svg',
        origin,
      });
      expect(panel.element.getAttribute('role')).toBe('dialog');
      expect(panel.element.dataset.hpmViewport).toBe(viewport);
      expect(panel.element.getAttribute('aria-label')).toContain('文章');
      expect(Array.from(panel.element.querySelectorAll('time')).map((el) => el.dateTime)).toEqual([
        b.date,
        a.date,
      ]);
      const links = Array.from(panel.element.querySelectorAll('a'));
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        '/blog/b/',
        '/blog/b/',
        '/blog/a/',
        '/blog/a/',
      ]);
      expect(panel.element.querySelector('[onerror]')).toBe(null);
      expect(panel.element.textContent).toContain(a.title);
      const image = panel.element.querySelector('img')!;
      expect(image.width).toBe(96);
      expect(image.height).toBe(72);
      expect(image.loading).toBe('lazy');
      image.dispatchEvent(new Event('error'));
      expect(image.getAttribute('src')).toBe('/placeholder.svg');
      image.dispatchEvent(new Event('error'));
      expect(image.getAttribute('src')).toBe('/placeholder.svg');
      expect(panel.element.contains(document.activeElement)).toBe(true);
      panel.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(panel.element.isConnected).toBe(false);
      expect(document.activeElement).toBe(origin);
      panel.destroy();
    },
  );
  it('rejects executable post and image URLs even when used without the controller', () => {
    const panel = renderPostPanel(
      [{ ...a, url: 'javascript:alert(1)', image: 'data:text/html,hi' }],
      'desktop',
      { container: document.body, placeholderUrl: '/placeholder.svg' },
    );
    expect(panel.element.querySelector('a')).toBe(null);
    expect(panel.element.querySelector('img')!.getAttribute('src')).toBe('/placeholder.svg');
    panel.destroy();
  });
});

describe('overview hydration', () => {
  it('fetches root-aware versioned data and only replaces SSR after map completion', async () => {
    const root = fixture();
    const pending = deferred<MapHandle>();
    const mountOverview = vi.fn<MapProvider['mountOverview']>(() => pending.promise);
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ version: 1, posts: [a, b] })),
    );
    const controller = hydrateOverview(
      root,
      async () => ({ mountDetail: vi.fn(), mountOverview }),
      fetcher,
    );
    await flush();
    expect(fetcher.mock.calls[0]?.[0]).toBe('/blog/map/posts.json');
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(mountOverview.mock.calls[0]?.[1]).toMatchObject({
      posts: [a, b],
      gridSize: 60,
      maxZoom: 18,
      placeholderUrl: '/blog/assets/placeholder.svg',
    });
    const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
    pending.resolve(handle);
    await flush();
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(true);
    expect(root.querySelector('[data-hpm-show-list]')).not.toBe(null);
    (root.querySelector('[data-hpm-show-list]') as HTMLButtonElement).click();
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    const activate = root.querySelector<HTMLButtonElement>('[data-hpm-activate]')!;
    expect(handle.setInteractive).not.toHaveBeenCalledWith(true);
    activate.click();
    expect(handle.setInteractive).toHaveBeenLastCalledWith(true);
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(handle.setInteractive).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(activate);
    controller.destroy();
  });
  it('opens a selected leaf or terminal group and closes panels before map Escape', async () => {
    const { root, mountOverview, controller, handle } = setup();
    await flush();
    root.querySelector<HTMLButtonElement>('[data-hpm-activate]')!.click();
    const model = mountOverview.mock.calls[0]![1];
    const origin = document.createElement('button');
    root.append(origin);
    origin.focus();
    model.onPostSelect(a, origin);
    expect(root.querySelectorAll('.hpm-panel .hpm-post')).toHaveLength(1);
    model.onGroupSelect([a, b], origin);
    expect(root.querySelectorAll('.hpm-panel')).toHaveLength(1);
    expect(root.querySelectorAll('.hpm-panel .hpm-post')).toHaveLength(2);
    root
      .querySelector('.hpm-panel')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelector('.hpm-panel')).toBe(null);
    expect(handle.setInteractive).toHaveBeenLastCalledWith(true);
    expect(document.activeElement).toBe(origin);
    controller.destroy();
  });
  it.each([
    { version: 2, posts: [] },
    { version: 1, posts: [{}] },
    { version: 1, posts: [{ ...a, location: { ...a.location, longitude: 181 } }] },
    null,
  ])('retains SSR for malformed envelope %j', async (data) => {
    const { root, load } = setup(data);
    await flush();
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(root.querySelector('[data-hpm-status]')!.textContent).toContain('无法加载');
  });
  it('shows empty state without loading AMap', async () => {
    const { root, load } = setup({ version: 1, posts: [] });
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(root.textContent).toContain('暂无标注地点的文章');
  });
  it.each(['fetch', 'http', 'provider', 'mount', 'runtime'])(
    'retains fallback on %s failure without exposing errors',
    async (stage) => {
      const root = fixture();
      let options: OverviewMapOptions | undefined;
      const controller = hydrateOverview(
        root,
        async () => {
          if (stage === 'provider') throw new Error('secret');
          return {
            mountDetail: vi.fn(),
            mountOverview: async (_container, model) => {
              options = model;
              if (stage === 'mount') throw new Error('secret');
              return { destroy() {}, setInteractive() {} };
            },
          };
        },
        async () => {
          if (stage === 'fetch') throw new Error('secret');
          return new Response(JSON.stringify({ version: 1, posts: [a] }), {
            status: stage === 'http' ? 500 : 200,
          });
        },
      );
      await flush();
      if (stage === 'runtime') options!.onError?.();
      expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
      expect(root.textContent).not.toContain('secret');
      controller.destroy();
    },
  );
  it('deduplicates across independent bundle modules and rebuilds after pagehide', async () => {
    const { root, load, fetcher, controller } = setup();
    initializeOverviewMaps(document, load, fetcher);
    vi.resetModules();
    const other = await import('../../src/browser/overview/index');
    expect(other.hydrateOverview(root, load, fetcher)).toBe(controller);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(other.hydrateOverview(root, load, fetcher)).not.toBe(controller);
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it.each(['fetch', 'provider', 'mount'])(
    'ignores late %s completion after destroy and aborts requests',
    async (stage) => {
      const root = fixture();
      const response = deferred<Response>();
      const provider = deferred<MapProvider>();
      const mount = deferred<MapHandle>();
      const late = { destroy: vi.fn(), setInteractive: vi.fn() };
      const mountOverview = vi.fn<MapProvider['mountOverview']>(() =>
        stage === 'mount' ? mount.promise : Promise.resolve(late),
      );
      const load = vi.fn(() =>
        stage === 'provider'
          ? provider.promise
          : Promise.resolve({ mountOverview, mountDetail: vi.fn() }),
      );
      let signal: AbortSignal | null | undefined;
      const controller = hydrateOverview(root, load, async (_url, init) => {
        signal = init?.signal;
        return stage === 'fetch'
          ? response.promise
          : new Response(JSON.stringify({ version: 1, posts: [a] }));
      });
      await flush();
      controller.destroy();
      expect(signal?.aborted).toBe(true);
      response.resolve(new Response(JSON.stringify({ version: 1, posts: [a] })));
      provider.resolve({ mountOverview, mountDetail: vi.fn() });
      mount.resolve(late);
      await flush();
      expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
      if (stage === 'fetch') expect(load).not.toHaveBeenCalled();
      if (stage === 'provider') expect(mountOverview).not.toHaveBeenCalled();
      if (stage === 'mount') expect(late.destroy).toHaveBeenCalledTimes(1);
    },
  );
});
