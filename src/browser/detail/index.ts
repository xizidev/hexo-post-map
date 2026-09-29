import type { DetailMapHandle, ProviderLoader } from '../providers/types';
import { registerRuntimeHydrator } from '../runtime/bridge';
import { FEATURES, type RuntimeController } from '../runtime/types';
import { readDetailConfig } from '../shared/config';
import { setStatus, showFallback } from '../shared/dom';
import { loadProvider } from '../shared/provider-loader';
import { createPlaybackController, type PlaybackController } from './playback';
import { loadTrackAsset } from './track-data';

const controllersKey = Symbol.for('hexo-post-map.detail-controllers.v1');
function controllers(): WeakMap<HTMLElement, RuntimeController> {
  const page = window as unknown as Record<
    symbol,
    WeakMap<HTMLElement, RuntimeController> | undefined
  >;
  return (page[controllersKey] ??= new WeakMap());
}

export function hydrateDetail(
  root: HTMLElement,
  load: ProviderLoader = loadProvider,
  fetcher: typeof fetch = fetch,
): RuntimeController {
  const registry = controllers();
  const existing = registry.get(root);
  if (existing) return existing;
  const controller = { destroy, isCurrent };
  registry.set(root, controller);
  const abort = new AbortController();
  let handle: DetailMapHandle | undefined;
  let playback: PlaybackController | undefined;
  let observer: IntersectionObserver | undefined;
  let started = false;
  let disposed = false;
  let failed = false;
  const canvas = root.querySelector<HTMLElement>('[data-hpm-canvas]');
  const data = root.querySelector('[data-hpm-data]');
  const playbackRoot = root.querySelector<HTMLElement>('[data-hpm-playback]');
  const playButton = root.querySelector<HTMLButtonElement>('[data-hpm-play]');
  const restartButton = root.querySelector<HTMLButtonElement>('[data-hpm-restart]');
  const progress = root.querySelector<HTMLInputElement>('[data-hpm-progress]');
  let requiresPlaybackControls = false;

  function isCurrent() {
    return (
      !disposed &&
      root.isConnected &&
      root.querySelector('[data-hpm-canvas]') === canvas &&
      root.querySelector('[data-hpm-data]') === data &&
      (!requiresPlaybackControls ||
        (root.querySelector('[data-hpm-playback]') === playbackRoot &&
          root.querySelector('[data-hpm-play]') === playButton &&
          root.querySelector('[data-hpm-restart]') === restartButton &&
          root.querySelector('[data-hpm-progress]') === progress))
    );
  }

  function fail() {
    if (disposed) return;
    if (!isCurrent()) {
      teardown(false);
      return;
    }
    failed = true;
    abort.abort();
    if (canvas) canvas.tabIndex = -1;
    root.dataset.hpmActive = 'false';
    showFallback(root, true);
    setStatus(root, '地图暂时无法加载，请使用下方地点链接。');
    playback?.destroy();
    playback = undefined;
    handle?.destroy();
  }
  function teardown(updateDom: boolean) {
    if (disposed) return;
    disposed = true;
    if (registry.get(root) === controller) registry.delete(root);
    observer?.disconnect();
    playback?.destroy();
    playback = undefined;
    abort.abort();
    handle?.destroy();
    if (updateDom) {
      if (canvas) canvas.tabIndex = -1;
      if (playbackRoot) playbackRoot.hidden = true;
      root.dataset.hpmActive = 'false';
      showFallback(root, true);
    }
  }
  function destroy() {
    teardown(true);
  }
  let config: ReturnType<typeof readDetailConfig>;
  try {
    config = readDetailConfig(root);
    if (!canvas) throw new Error('Missing map canvas');
    requiresPlaybackControls = config.track?.playback === true;
    if (requiresPlaybackControls && (!playbackRoot || !playButton || !restartButton || !progress)) {
      throw new Error('Missing track playback controls');
    }
    root.style.setProperty('--hpm-detail-height', config.height);
    canvas.tabIndex = -1;
    const names = config.map.points.map((point) => point.name).join('、');
    canvas.setAttribute('aria-label', `文章地点地图：${names}`);
  } catch {
    fail();
    return controller;
  }

  function showTrackFallback() {
    if (disposed || failed) return;
    if (!isCurrent()) {
      teardown(false);
      return;
    }
    playback?.destroy();
    playback = undefined;
    if (playbackRoot) playbackRoot.hidden = true;
    setStatus(root, '轨迹暂时无法加载，已显示地点路线。');
  }

  async function start() {
    if (started || disposed) return;
    started = true;
    observer?.disconnect();
    setStatus(root, '');
    try {
      const providerPromise = load(config);
      let trackFailed = false;
      const trackPromise = config.track
        ? loadTrackAsset(config.track.url, abort.signal, fetcher).catch(() => {
            if (!abort.signal.aborted) trackFailed = true;
            return undefined;
          })
        : Promise.resolve(undefined);
      const [provider, track] = await Promise.all([providerPromise, trackPromise]);
      if (disposed) return;
      if (!isCurrent()) {
        teardown(false);
        return;
      }
      const mounted = await provider.mountDetail(canvas!, {
        map: config.map,
        defaultZoom: config.defaultZoom,
        track,
        signal: abort.signal,
        onError: fail,
        onTrackError: showTrackFallback,
      });
      if (disposed || failed || !isCurrent()) {
        mounted.destroy();
        if (!disposed && !failed) teardown(false);
        return;
      }
      handle = mounted;
      handle.setInteractive(true);
      if (disposed || failed) return;
      canvas!.tabIndex = 0;
      root.dataset.hpmActive = 'true';
      showFallback(root, false);
      if (config.track && track && mounted.hasTrack === true) {
        if (config.track.playback) {
          try {
            playback = createPlaybackController(root, mounted, { isCurrent });
          } catch {
            trackFailed = true;
          }
        }
      } else if (config.track) {
        trackFailed = true;
      }
      if (trackFailed) showTrackFallback();
      else setStatus(root, '');
    } catch {
      fail();
    }
  }
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void start();
      },
      { rootMargin: '300px' },
    );
    observer.observe(root);
  } else {
    void start();
  }
  return controller;
}

export function initializeDetailMaps(
  scope: ParentNode = document,
  load: ProviderLoader = loadProvider,
): void {
  scope
    .querySelectorAll<HTMLElement>('[data-hpm-detail]')
    .forEach((root) => hydrateDetail(root, load));
}
registerRuntimeHydrator({
  id: 'detail',
  selector: FEATURES.detail.selector,
  mount: hydrateDetail,
});
