// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrateDetail as mountDetail, initializeDetailMaps } from '../../src/browser/detail/index';
import { renderDetailMap } from '../../src/templates/detail';
import { resolveConfig } from '../../src/config/resolve';
import { normalizePostMap } from '../../src/domain/normalize';
import type { DetailMapModel, MapHandle, MapProvider } from '../../src/browser/providers/types';
import type { PublishedTrackAsset } from '../../src/tracks/types';

const config = resolveConfig(
  { enabled: true, amap: { key: 'key', security: { service_host: 'https://example.com/proxy' } } },
  {},
)!;
const map = normalizePostMap(
  { points: [{ id: 'a', name: '上海', longitude: 121, latitude: 31 }] },
  'test.md',
)!;
function fixture() {
  document.body.innerHTML = renderDetailMap({ map, config });
  return document.querySelector<HTMLElement>('[data-hpm-detail]')!;
}
const trackStats = { distanceMeters: 1_200, elevationGainMeters: 30, durationSeconds: 600 };
const trackAsset = Object.freeze({
  version: 1,
  coordinateSystem: 'wgs84',
  segments: Object.freeze([
    Object.freeze([Object.freeze([118.7, 32] as const), Object.freeze([118.8, 32.1, 12] as const)]),
  ]),
  stats: Object.freeze(trackStats),
}) satisfies PublishedTrackAsset;
function trackedFixture(playback = true) {
  document.body.innerHTML = renderDetailMap({
    map,
    config,
    track: {
      url: `/hexo-post-map/tracks/${'a'.repeat(64)}.json`,
      stats: trackStats,
      playback,
    },
  });
  return document.querySelector<HTMLElement>('[data-hpm-detail]')!;
}
function trackResponse(body: unknown = trackAsset, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const activeControllers = new Set<ReturnType<typeof mountDetail>>();
function hydrateDetail(...args: Parameters<typeof mountDetail>) {
  const controller = mountDetail(...args);
  activeControllers.add(controller);
  return controller;
}
afterEach(() => {
  activeControllers.forEach((controller) => controller.destroy());
  activeControllers.clear();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('tracked detail server rendering', () => {
  it('renders semantic visible statistics and fallback with initially hidden labelled playback controls', () => {
    const track = {
      url: `/blog/hexo-post-map/tracks/${'a'.repeat(64)}.json`,
      stats: { distanceMeters: 1234, elevationGainMeters: 125, durationSeconds: 5400 },
      playback: true,
      source: '_posts/private-track.gpx',
      name: 'PRIVATE_NAME',
      timestamp: 'PRIVATE_TIMESTAMP',
    };
    document.body.innerHTML = renderDetailMap({ map, config, track });
    const stats = document.querySelector<HTMLElement>('[data-hpm-track-stats]')!;
    expect(stats?.tagName).toBe('DL');
    expect(stats.hidden).toBe(false);
    expect([...stats.querySelectorAll('dt')].map((node) => node.textContent)).toEqual([
      '距离',
      '累计爬升',
      '时长',
    ]);
    expect([...stats.querySelectorAll('dd')].map((node) => node.textContent)).toEqual([
      '1.23 公里',
      '125 米',
      '1 小时 30 分钟',
    ]);
    expect(document.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(document.querySelector('[data-hpm-fallback] a')!.textContent).toBe('上海');
    expect(document.querySelector('[data-hpm-status]')!.getAttribute('aria-live')).toBe('polite');
    const controls = document.querySelector<HTMLElement>('[data-hpm-playback]')!;
    expect(controls?.hidden).toBe(true);
    expect(controls.querySelector('[data-hpm-play]')?.textContent).toBe('播放');
    expect(controls.querySelector('[data-hpm-play]')?.getAttribute('aria-pressed')).toBe('false');
    expect(controls.querySelector('[data-hpm-restart]')?.textContent).toBe('重新开始');
    const range = controls.querySelector<HTMLInputElement>('[data-hpm-progress]')!;
    expect(range.type).toBe('range');
    expect(range.getAttribute('aria-label')).toBe('轨迹播放进度');
    expect([range.min, range.max, range.step, range.value]).toEqual(['0', '1', '0.001', '0']);
    const embedded = JSON.parse(document.querySelector('[data-hpm-data]')!.textContent!);
    expect(embedded.track).toEqual({ url: track.url, stats: track.stats, playback: true });
    expect(document.body.innerHTML).not.toMatch(/private-track|PRIVATE_NAME|PRIVATE_TIMESTAMP/);
  });

  it('omits optional statistics and controls when playback is disabled while safely serializing data', () => {
    const name = '</script><img src=x onerror=alert(1)>';
    const unsafeMap = normalizePostMap(
      { points: [{ id: 'a', name, longitude: 121, latitude: 31 }] },
      'a.md',
    )!;
    document.body.innerHTML = renderDetailMap({
      map: unsafeMap,
      config,
      track: {
        url: `/hexo-post-map/tracks/${'b'.repeat(64)}.json`,
        stats: { distanceMeters: 10 },
        playback: false,
      },
    });
    expect(document.querySelectorAll('[data-hpm-track-stats] dd')).toHaveLength(1);
    expect(document.querySelector('[data-hpm-playback]')).toBeNull();
    expect(document.querySelectorAll('script')).toHaveLength(1);
    expect(document.querySelector('img')).toBeNull();
    expect(
      JSON.parse(document.querySelector('[data-hpm-data]')!.textContent!).map.points[0].name,
    ).toBe(name);
  });

  it('leaves point-only markup and browser data free of track additions', () => {
    const root = fixture();
    expect(root.querySelector('[data-hpm-track-stats], [data-hpm-playback]')).toBeNull();
    expect(JSON.parse(root.querySelector('[data-hpm-data]')!.textContent!)).not.toHaveProperty(
      'track',
    );
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(root.querySelector('[data-hpm-canvas]')).not.toBeNull();
  });
});

describe('detail hydration', () => {
  it.each(['canvas', 'data'])('detects replacement of the captured %s node', (node) => {
    const root = fixture();
    const controller = hydrateDetail(root, vi.fn());
    expect(controller.isCurrent()).toBe(true);
    const original = root.querySelector(`[data-hpm-${node}]`)!;
    original.replaceWith(original.cloneNode(true));
    expect(controller.isCurrent()).toBe(false);
    controller.destroy();
    expect(controller.isCurrent()).toBe(false);
  });

  it('stays current when a connected root moves, but not when disconnected or destroyed', () => {
    const root = fixture();
    const controller = hydrateDetail(root, vi.fn());
    const container = document.createElement('aside');
    document.body.append(container);
    container.append(root);
    expect(controller.isCurrent()).toBe(true);
    root.remove();
    expect(controller.isCurrent()).toBe(false);
    container.append(root);
    expect(controller.isCurrent()).toBe(true);
    controller.destroy();
    expect(controller.isCurrent()).toBe(false);
  });

  it('embeds the normalized map style in detail configuration', () => {
    const root = fixture();
    const embedded = JSON.parse(root.querySelector('[data-hpm-data]')!.textContent ?? '{}') as {
      amap?: { mapStyle?: string };
    };

    expect(embedded.amap?.mapStyle).toBe('amap://styles/normal');
  });

  it('keeps one usable map across repeated hydration until explicitly destroyed', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = fixture();
    const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
    const mountDetail = vi.fn<MapProvider['mountDetail']>(async () => handle);
    const load = vi.fn(async () => ({ mountDetail, mountOverview: vi.fn() }));
    const controller = hydrateDetail(root, load);
    const canvas = root.querySelector<HTMLElement>('[data-hpm-canvas]')!;
    expect(canvas.tabIndex).toBe(-1);
    await flush();
    expect(canvas.tabIndex).toBe(0);
    for (let visit = 0; visit < 2; visit++) {
      await flush();
      expect(root.querySelectorAll('[data-hpm-activate]')).toHaveLength(0);
      expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(true);
      expect(root.dataset.hpmActive).toBe('true');
      expect(handle.setInteractive).toHaveBeenLastCalledWith(true);
      expect(canvas.tabIndex).toBe(0);
      expect(hydrateDetail(root, load)).toBe(controller);
    }
    expect(load).toHaveBeenCalledTimes(1);
    expect(mountDetail).toHaveBeenCalledTimes(1);
    expect(handle.destroy).not.toHaveBeenCalled();
    controller.destroy();
    expect(canvas.tabIndex).toBe(-1);
    expect(handle.destroy).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll('[data-hpm-activate]')).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('allows a pending map to finish without aborting its owner', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = fixture();
    const pending = deferred<MapHandle>();
    let signal: AbortSignal | undefined;
    hydrateDetail(root, async () => ({
      mountDetail: (_container, model) => {
        signal = model.signal;
        return pending.promise;
      },
      mountOverview: vi.fn(),
    }));
    await flush();
    expect(signal?.aborted).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-hpm-canvas]')!.tabIndex).toBe(-1);
    const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
    pending.resolve(handle);
    await flush();
    expect(root.querySelector('[data-hpm-activate]')).toBe(null);
    expect(handle.setInteractive).toHaveBeenLastCalledWith(true);
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(true);
    expect(handle.destroy).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLElement>('[data-hpm-canvas]')!.tabIndex).toBe(0);
  });
  it('releases failed configuration registration on destroy before explicit rebuild', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = fixture();
    const data = root.querySelector('[data-hpm-data]')!;
    const valid = data.textContent;
    data.textContent = '{';
    const load = vi.fn(async () => ({
      mountDetail: async () => ({ destroy: vi.fn(), setInteractive: vi.fn() }),
      mountOverview: vi.fn(),
    }));
    const failed = hydrateDetail(root, load);
    failed.destroy();
    data.textContent = valid;
    const rebuilt = hydrateDetail(root, load);
    expect(rebuilt).not.toBe(failed);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    rebuilt.destroy();
  });
  it('deduplicates sections across repeated initialization and independent bundle modules', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = fixture();
    const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
    const mountDetail = vi.fn<MapProvider['mountDetail']>(async () => handle);
    const load = vi.fn(async () => ({ mountDetail, mountOverview: vi.fn() }));
    const first = hydrateDetail(root, load);
    initializeDetailMaps(document, load);
    vi.resetModules();
    const otherBundle = await import('../../src/browser/detail/index');
    otherBundle.initializeDetailMaps(document, load);
    expect(otherBundle.hydrateDetail(root, load)).toBe(first);
    await flush();
    expect(root.querySelectorAll('[data-hpm-activate]')).toHaveLength(0);
    expect(mountDetail).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    first.destroy();
  });

  it('releases the section registration after destroy so explicit initialization can rebuild', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = fixture();
    const handles = Array.from({ length: 2 }, () => ({
      destroy: vi.fn(),
      setInteractive: vi.fn(),
    }));
    const mountDetail = vi
      .fn<MapProvider['mountDetail']>()
      .mockResolvedValueOnce(handles[0]!)
      .mockResolvedValueOnce(handles[1]!);
    const load = async () => ({ mountDetail, mountOverview: vi.fn() });
    const first = hydrateDetail(root, load);
    await flush();
    const canvas = root.querySelector<HTMLElement>('[data-hpm-canvas]')!;
    expect(canvas.tabIndex).toBe(0);
    first.destroy();
    expect(canvas.tabIndex).toBe(-1);
    expect(root.querySelectorAll('[data-hpm-activate]')).toHaveLength(0);
    const second = hydrateDetail(root, load);
    expect(second).not.toBe(first);
    await flush();
    expect(mountDetail).toHaveBeenCalledTimes(2);
    expect(root.querySelectorAll('[data-hpm-activate]')).toHaveLength(0);
    expect(handles[1]!.setInteractive).toHaveBeenLastCalledWith(true);
    expect(handles[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(canvas.tabIndex).toBe(0);
    second.destroy();
    expect(canvas.tabIndex).toBe(-1);
  });
  it('waits until intersection within 300px and keeps SSR links until complete', async () => {
    let intersect!: IntersectionObserverCallback;
    const disconnect = vi.fn();
    let options: IntersectionObserverInit | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback, init?: IntersectionObserverInit) {
          intersect = callback;
          options = init;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const root = fixture();
    const pending = deferred<MapHandle>();
    const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
    const mountDetail = vi.fn<MapProvider['mountDetail']>(() => pending.promise);
    const load = vi.fn(async () => ({ mountDetail, mountOverview: vi.fn() }));
    const controller = hydrateDetail(root, load);
    const canvas = root.querySelector<HTMLElement>('[data-hpm-canvas]')!;
    expect(canvas.tabIndex).toBe(-1);
    expect(load).not.toHaveBeenCalled();
    expect(options?.rootMargin).toBe('300px');
    intersect([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(load).not.toHaveBeenCalled();
    intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(canvas.tabIndex).toBe(-1);
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(root.querySelector('[data-hpm-status]')!.textContent).toBe('');
    expect(mountDetail.mock.calls[0]?.[1]).toMatchObject({ map, defaultZoom: 11 });
    pending.resolve(handle);
    await flush();
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(true);
    expect(root.querySelector('[data-hpm-status]')!.textContent).toBe('');
    expect(handle.setInteractive).toHaveBeenLastCalledWith(true);
    expect(disconnect).toHaveBeenCalled();
    expect(canvas.tabIndex).toBe(0);
    controller.destroy();
    expect(canvas.tabIndex).toBe(-1);
    expect(handle.destroy).toHaveBeenCalledTimes(1);
  });

  it('enables interaction automatically without an activation overlay or success prompt', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = fixture();
    const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
    const controller = hydrateDetail(root, async () => ({
      mountDetail: async () => handle,
      mountOverview: vi.fn(),
    }));
    await flush();
    expect(root.querySelector('[data-hpm-activate]')).toBe(null);
    expect(handle.setInteractive).toHaveBeenLastCalledWith(true);
    expect(root.dataset.hpmActive).toBe('true');
    expect(root.querySelector('[data-hpm-status]')!.textContent).toBe('');
    controller.destroy();
  });

  it.each(['load', 'mount', 'interaction', 'runtime'])(
    'retains or restores fallback on %s failure',
    async (stage) => {
      vi.stubGlobal('IntersectionObserver', undefined);
      const root = fixture();
      const handle = {
        destroy: vi.fn(),
        setInteractive: vi.fn(() => {
          if (stage === 'interaction') throw new Error('private interaction error');
        }),
      };
      let model!: DetailMapModel;
      const provider: MapProvider = {
        mountDetail: async (_container, data) => {
          model = data;
          if (stage === 'mount') throw new Error('private error');
          return handle;
        },
        mountOverview: vi.fn(),
      };
      const controller = hydrateDetail(root, async () => {
        if (stage === 'load') throw new Error('private credentials');
        return provider;
      });
      await flush();
      const canvas = root.querySelector<HTMLElement>('[data-hpm-canvas]')!;
      if (stage === 'runtime') {
        expect(canvas.tabIndex).toBe(0);
        model.onError?.();
      }
      expect(canvas.tabIndex).toBe(-1);
      expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
      expect(root.querySelector('a')!.href).toContain('uri.amap.com');
      expect(root.querySelector('[data-hpm-status]')!.textContent).toContain('暂时无法加载');
      expect(root.textContent).not.toContain('private');
      controller.destroy();
    },
  );

  it('aborts pending mounts on destroy and destroys late handles without hiding fallback', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = fixture();
    const pending = deferred<MapHandle>();
    let signal: AbortSignal | undefined;
    const controller = hydrateDetail(root, async () => ({
      mountDetail: (_container, model) => {
        signal = model.signal;
        return pending.promise;
      },
      mountOverview: vi.fn(),
    }));
    await flush();
    controller.destroy();
    expect(signal?.aborted).toBe(true);
    const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
    pending.resolve(handle);
    await flush();
    expect(handle.destroy).toHaveBeenCalledTimes(1);
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-hpm-canvas]')!.tabIndex).toBe(-1);
    controller.destroy();
  });

  it('handles invalid embedded JSON locally without loading a provider', async () => {
    const root = fixture();
    root.querySelector('[data-hpm-data]')!.textContent = '{';
    const load = vi.fn();
    hydrateDetail(root, load);
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-hpm-canvas]')!.tabIndex).toBe(-1);
    expect(root.querySelector('[data-hpm-status]')!.textContent).toContain('暂时无法加载');
  });

  it('starts provider and track loading together only after the existing intersection boundary', async () => {
    let intersect!: IntersectionObserverCallback;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersect = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const root = trackedFixture();
    const providerPending = deferred<MapProvider>();
    const responsePending = deferred<Response>();
    const load = vi.fn(() => providerPending.promise);
    const fetcher = vi.fn<typeof fetch>(() => responsePending.promise);
    const mount = vi.fn<MapProvider['mountDetail']>();
    const handle = {
      hasTrack: true,
      destroy: vi.fn(),
      setInteractive: vi.fn(),
      setTrackProgress: vi.fn(),
    };
    mount.mockResolvedValue(handle);

    hydrateDetail(root, load, fetcher);
    expect(load).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();

    intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(load).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const fetchSignal = (fetcher.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;
    expect(fetchSignal).toBeInstanceOf(AbortSignal);

    providerPending.resolve({ mountDetail: mount, mountOverview: vi.fn() });
    responsePending.resolve(trackResponse());
    await flush();

    const model = mount.mock.calls[0]?.[1];
    expect(model?.track).toEqual(trackAsset);
    expect(model?.signal).toBe(fetchSignal);
    expect(root.querySelector<HTMLElement>('[data-hpm-playback]')!.hidden).toBe(false);
    expect(handle.setTrackProgress).toHaveBeenLastCalledWith(0);
    expect(root.dataset.hpmActive).toBe('true');
  });

  it('passes a display-only track to the provider without creating playback controls', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = trackedFixture(false);
    const mount = vi.fn<MapProvider['mountDetail']>(async () => ({
      hasTrack: true,
      destroy: vi.fn(),
      setInteractive: vi.fn(),
      setTrackProgress: vi.fn(),
    }));
    const fetcher = vi.fn<typeof fetch>(async () => trackResponse());

    hydrateDetail(root, async () => ({ mountDetail: mount, mountOverview: vi.fn() }), fetcher);
    await flush();

    expect(mount.mock.calls[0]?.[1].track).toEqual(trackAsset);
    expect(root.querySelector('[data-hpm-playback]')).toBeNull();
    expect(root.dataset.hpmActive).toBe('true');
  });

  it('uses the unchanged point model and a generic status when track loading fails', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = trackedFixture();
    const mount = vi.fn<MapProvider['mountDetail']>(async () => ({
      hasTrack: false,
      destroy: vi.fn(),
      setInteractive: vi.fn(),
    }));
    const fetcher = vi.fn<typeof fetch>(async () => trackResponse({ private: 'secret' }, 500));

    hydrateDetail(root, async () => ({ mountDetail: mount, mountOverview: vi.fn() }), fetcher);
    await flush();

    expect(mount.mock.calls[0]?.[1]).toMatchObject({ map, track: undefined });
    expect(root.dataset.hpmActive).toBe('true');
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('[data-hpm-playback]')!.hidden).toBe(true);
    expect(root.querySelector('[data-hpm-status]')!.textContent).toBe(
      '轨迹暂时无法加载，已显示地点路线。',
    );
    expect(root.textContent).not.toContain('private');
  });

  it('keeps the complete place-list fallback when the provider fails after track loading', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = trackedFixture();
    const fetcher = vi.fn<typeof fetch>(async () => trackResponse());

    hydrateDetail(
      root,
      async () => {
        throw new Error('private provider credential');
      },
      fetcher,
    );
    await flush();

    expect(root.dataset.hpmActive).toBe('false');
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(root.querySelector('[data-hpm-fallback] a')?.textContent).toBe('上海');
    expect(root.querySelector('[data-hpm-status]')!.textContent).toContain('地图暂时无法加载');
    expect(root.textContent).not.toContain('credential');
  });

  it('deduplicates a tracked root so repeated hydration performs one track fetch', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = trackedFixture();
    const handle = {
      hasTrack: true,
      destroy: vi.fn(),
      setInteractive: vi.fn(),
      setTrackProgress: vi.fn(),
    };
    const load = vi.fn(async () => ({
      mountDetail: async () => handle,
      mountOverview: vi.fn(),
    }));
    const fetcher = vi.fn<typeof fetch>(async () => trackResponse());

    const first = hydrateDetail(root, load, fetcher);
    const second = hydrateDetail(root, load, fetcher);
    await flush();

    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it.each(['playback', 'play', 'restart', 'progress'])(
    'detects replacement of the captured track %s control',
    (control) => {
      const root = trackedFixture();
      const controller = hydrateDetail(root, vi.fn(), vi.fn());
      const original = root.querySelector(`[data-hpm-${control}]`)!;

      original.replaceWith(original.cloneNode(true));

      expect(controller.isCurrent()).toBe(false);
    },
  );

  it('aborts the shared lifecycle and ignores late provider and track results after destroy', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = trackedFixture();
    const providerPending = deferred<MapProvider>();
    const responsePending = deferred<Response>();
    const mount = vi.fn<MapProvider['mountDetail']>();
    const fetcher = vi.fn<typeof fetch>(() => responsePending.promise);
    const controller = hydrateDetail(root, () => providerPending.promise, fetcher);
    await Promise.resolve();
    const signal = (fetcher.mock.calls[0]?.[1] as RequestInit | undefined)?.signal as AbortSignal;

    controller.destroy();
    expect(signal.aborted).toBe(true);
    providerPending.resolve({ mountDetail: mount, mountOverview: vi.fn() });
    responsePending.resolve(trackResponse());
    await flush();

    expect(mount).not.toHaveBeenCalled();
    expect(root.dataset.hpmActive).toBe('false');
    expect(root.querySelector<HTMLElement>('[data-hpm-playback]')!.hidden).toBe(true);
  });

  it('does not mutate replacement-root DOM when a provider callback arrives after staleness', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = trackedFixture();
    let model!: DetailMapModel;
    const fetcher = vi.fn<typeof fetch>(async () => trackResponse());
    hydrateDetail(
      root,
      async () => ({
        mountDetail: async (_container, current) => {
          model = current;
          return {
            hasTrack: true,
            destroy: vi.fn(),
            setInteractive: vi.fn(),
            setTrackProgress: vi.fn(),
          };
        },
        mountOverview: vi.fn(),
      }),
      fetcher,
    );
    await flush();
    const controls = root.querySelector<HTMLElement>('[data-hpm-playback]')!;
    const status = root.querySelector<HTMLElement>('[data-hpm-status]')!;
    const fallback = root.querySelector<HTMLElement>('[data-hpm-fallback]')!;
    expect(controls.hidden).toBe(false);
    root
      .querySelector('[data-hpm-canvas]')!
      .replaceWith(root.querySelector('[data-hpm-canvas]')!.cloneNode(true));

    model.onError?.();

    expect(controls.hidden).toBe(false);
    expect(status.textContent).toBe('');
    expect(fallback.hidden).toBe(true);
    expect(root.dataset.hpmActive).toBe('true');
  });

  it('rejects non-whitelisted track descriptor fields before any external work', async () => {
    const root = trackedFixture();
    const data = root.querySelector('[data-hpm-data]')!;
    const embedded = JSON.parse(data.textContent ?? '{}');
    embedded.track.source = '_posts/private.gpx';
    data.textContent = JSON.stringify(embedded);
    const load = vi.fn();
    const fetcher = vi.fn();

    hydrateDetail(root, load, fetcher);
    await flush();

    expect(load).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(root.querySelector('[data-hpm-status]')!.textContent).not.toContain('private.gpx');
  });
});
