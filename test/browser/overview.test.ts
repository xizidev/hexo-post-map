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
function pageTransition(type: 'pagehide' | 'pageshow', persisted: boolean) {
  const event = new PageTransitionEvent(type, { persisted });
  // happy-dom aliases PageTransitionEvent to Event and omits the persisted property.
  Object.defineProperty(event, 'persisted', { value: persisted });
  window.dispatchEvent(event);
}
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
  setZoom = vi.fn((zoom: number) => {
    this.zoom = zoom;
  });
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
  it.each([
    { start: 6, maxZoom: 8, steps: [7, 8] },
    { start: 6.25, maxZoom: 8.5, steps: [7.25, 8.25, 8.5] },
    { start: 2, maxZoom: 2.5, steps: [2.5] },
  ])(
    'advances a no-op fit at gridSize 1024 to a bounded terminal list ($start -> $maxZoom)',
    async ({ start, maxZoom, steps }) => {
      const provider = await adapter();
      const options = overviewOptions({
        gridSize: 1024,
        maxZoom,
        posts: [a, { ...b, location: { name: 'B', longitude: 122, latitude: 32 } }],
      });
      const pending = provider.mountOverview(document.createElement('div'), options);
      await flush();
      mapInstance.emit('complete');
      const handle = await pending;
      handle.setInteractive(true);
      mapInstance.zoom = start;
      const marker = new ClusterMarker();
      clusterInstance.options.renderClusterMarker({ marker, clusterData: clusterInstance.data });
      const button = marker.content as HTMLButtonElement;
      for (const expected of steps) {
        button.click();
        expect(mapInstance.zoom).toBe(expected);
        expect(options.onGroupSelect).not.toHaveBeenCalled();
      }
      button.click();
      expect(mapInstance.setZoom.mock.calls.map(([zoom]) => zoom)).toEqual(steps);
      expect(options.onGroupSelect).toHaveBeenCalledOnce();
      handle.destroy();
    },
  );
  it.each([
    { fitted: 12, expected: 12, nudged: false },
    { fitted: 3, expected: 7, nudged: true },
  ])('uses the pre-click zoom when fit returns $fitted', async ({ fitted, expected, nudged }) => {
    const provider = await adapter();
    const pending = provider.mountOverview(
      document.createElement('div'),
      overviewOptions({
        posts: [a, { ...b, location: { name: 'B', longitude: 122, latitude: 32 } }],
      }),
    );
    await flush();
    mapInstance.emit('complete');
    const handle = await pending;
    handle.setInteractive(true);
    mapInstance.zoom = 6;
    mapInstance.setBounds.mockImplementation(() => {
      mapInstance.zoom = fitted;
    });
    const marker = new ClusterMarker();
    clusterInstance.options.renderClusterMarker({ marker, clusterData: clusterInstance.data });
    (marker.content as HTMLButtonElement).click();
    expect(mapInstance.zoom).toBe(expected);
    expect(mapInstance.setZoom).toHaveBeenCalledTimes(nudged ? 1 : 0);
    handle.destroy();
  });
  it.each(['same-marker', 'new-marker', 'removed-group'])(
    'restores focus after SDK redraw: %s',
    async (redraw) => {
      const root = fixture();
      const provider = await adapter();
      const controller = hydrateOverview(
        root,
        async () => provider,
        async () => new Response(JSON.stringify({ version: 1, posts: [a, b] })),
      );
      await flush();
      mapInstance.emit('complete');
      await flush();
      expect(root.querySelector('[data-hpm-activate]')).toBe(null);
      const canvas = root.querySelector<HTMLElement>('[data-hpm-canvas]')!;
      const marker = new ClusterMarker();
      clusterInstance.options.renderClusterMarker({ marker, clusterData: clusterInstance.data });
      const original = marker.content as HTMLButtonElement;
      canvas.append(original);
      original.click();
      expect(root.querySelector('.hpm-panel')!.contains(document.activeElement)).toBe(true);
      const replacementMarker = redraw === 'new-marker' ? new ClusterMarker() : marker;
      if (redraw === 'removed-group') {
        clusterInstance.options.renderMarker({
          marker: replacementMarker,
          data: [clusterInstance.data[0]!],
        });
      } else {
        clusterInstance.options.renderClusterMarker({
          marker: replacementMarker,
          clusterData: [...clusterInstance.data].reverse(),
        });
      }
      const replacement = replacementMarker.content!;
      original.replaceWith(replacement);
      root
        .querySelector('.hpm-panel')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(document.activeElement).toBe(redraw === 'removed-group' ? canvas : replacement);
      expect(root.dataset.hpmActive).toBe('true');
      controller.destroy();
    },
  );
  it.each([2, 2.5, 18.5, 20])(
    'preserves the supported maxZoom %s and minimum map zoom 2',
    async (maxZoom) => {
      const provider = await adapter();
      const pending = provider.mountOverview(
        document.createElement('div'),
        overviewOptions({ maxZoom }),
      );
      await flush();
      mapInstance.emit('complete');
      const handle = await pending;
      expect(mapInstance.options.zooms).toEqual([2, maxZoom]);
      expect(clusterInstance.options.maxZoom).toBe(maxZoom);
      handle.destroy();
    },
  );
  it.each([1.99, 20.01, NaN, Infinity, -Infinity])(
    'rejects unsupported adapter maxZoom %s before constructing a map',
    async (maxZoom) => {
      const provider = await adapter();
      const previous = mapInstance;
      const pending = provider.mountOverview(
        document.createElement('div'),
        overviewOptions({ maxZoom }),
      );
      const rejected = expect(pending).rejects.toThrow();
      await flush();
      if (mapInstance !== previous) mapInstance.emit('complete');
      await rejected;
      expect(mapInstance).toBe(previous);
    },
  );
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
      zooms: [2, 18],
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
    expect(options.onPostSelect).toHaveBeenCalledWith(a, button, expect.any(Function));
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
        expect(options.onGroupSelect).toHaveBeenCalledWith(
          [options.posts[1], a],
          button,
          expect.any(Function),
        );
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
  it('keeps one usable map and panel across repeated BFCache restores, then destroys on ordinary pagehide', async () => {
    const { root, load, fetcher, handle, mountOverview } = setup();
    await flush();
    const origin = document.createElement('button');
    root.querySelector('[data-hpm-canvas]')!.append(origin);
    for (let visit = 0; visit < 2; visit++) {
      mountOverview.mock.calls[0]![1].onPostSelect(a, origin);
      expect(root.querySelectorAll('.hpm-panel')).toHaveLength(1);
      pageTransition('pagehide', true);
      pageTransition('pageshow', true);
      pageTransition('pageshow', true);
      await flush();
      expect(root.querySelectorAll('[data-hpm-activate]')).toHaveLength(0);
      expect(root.querySelectorAll('[data-hpm-show-list]')).toHaveLength(1);
      expect(root.dataset.hpmActive).toBe('true');
      expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(true);
      root
        .querySelector('.hpm-panel')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(root.querySelectorAll('.hpm-panel')).toHaveLength(0);
      expect(document.activeElement).toBe(origin);
      expect(root.dataset.hpmActive).toBe('true');
      expect(handle.setInteractive).toHaveBeenLastCalledWith(true);
    }
    expect(load).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mountOverview).toHaveBeenCalledTimes(1);
    expect(handle.destroy).not.toHaveBeenCalled();
    pageTransition('pagehide', false);
    pageTransition('pageshow', false);
    expect(handle.destroy).toHaveBeenCalledTimes(1);
    expect(
      root.querySelectorAll('[data-hpm-activate], [data-hpm-show-list], .hpm-panel'),
    ).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('allows pending overview data to finish after BFCache restore with one request owner', async () => {
    const root = fixture();
    const response = deferred<Response>();
    let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      signal = init?.signal;
      return response.promise;
    });
    const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
    const mountOverview = vi.fn<MapProvider['mountOverview']>(async () => handle);
    hydrateOverview(root, async () => ({ mountOverview, mountDetail: vi.fn() }), fetcher);
    pageTransition('pagehide', true);
    pageTransition('pageshow', true);
    expect(signal?.aborted).toBe(false);
    response.resolve(new Response(JSON.stringify({ version: 1, posts: [a] })));
    await flush();
    expect(root.querySelector('[data-hpm-activate]')).toBe(null);
    expect(handle.setInteractive).toHaveBeenLastCalledWith(true);
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mountOverview).toHaveBeenCalledTimes(1);
  });
  it.each([2, 2.5, 18.5, 20])('accepts the server-supported finite maxZoom %s', async (maxZoom) => {
    const root = fixture();
    const data = root.querySelector('[data-hpm-data]')!;
    const settings = JSON.parse(data.textContent!);
    settings.cluster.maxZoom = maxZoom;
    data.textContent = JSON.stringify(settings);
    const mountOverview = vi.fn<MapProvider['mountOverview']>(async () => ({
      destroy() {},
      setInteractive() {},
    }));
    hydrateOverview(
      root,
      async () => ({ mountOverview, mountDetail: vi.fn() }),
      async () => new Response(JSON.stringify({ version: 1, posts: [a] })),
    );
    await flush();
    expect(mountOverview.mock.calls[0]?.[1].maxZoom).toBe(maxZoom);
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(true);
  });
  it.each(['1.99', '20.01', '1e309', '-1e309', 'null', '"2"'])(
    'rejects invalid embedded maxZoom %s without provider loading',
    async (value) => {
      const root = fixture();
      const data = root.querySelector('[data-hpm-data]')!;
      data.textContent = data.textContent!.replace('"maxZoom":18', `"maxZoom":${value}`);
      const load = vi.fn();
      hydrateOverview(root, load, vi.fn());
      await flush();
      expect(load).not.toHaveBeenCalled();
      expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
      expect(root.querySelector('[data-hpm-status]')!.textContent).toContain('无法加载');
    },
  );
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
    expect(root.querySelector('[data-hpm-activate]')).toBe(null);
    expect(root.querySelector('[data-hpm-status]')!.textContent).toBe('');
    expect(handle.setInteractive).toHaveBeenLastCalledWith(true);
    (root.querySelector('[data-hpm-show-list]') as HTMLButtonElement).click();
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    controller.destroy();
  });
  it('opens a selected leaf or terminal group and closes panels with Escape', async () => {
    const { root, mountOverview, controller, handle } = setup();
    await flush();
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
