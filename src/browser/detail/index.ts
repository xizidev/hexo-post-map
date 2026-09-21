import type { MapHandle, ProviderLoader } from '../providers/types';
import { readDetailConfig } from '../shared/config';
import { setStatus, showFallback } from '../shared/dom';
import { loadProvider } from '../shared/provider-loader';

interface DetailController {
  destroy(): void;
}
const controllersKey = Symbol.for('hexo-post-map.detail-controllers.v1');
function controllers(): WeakMap<HTMLElement, DetailController> {
  const page = window as unknown as Record<
    symbol,
    WeakMap<HTMLElement, DetailController> | undefined
  >;
  return (page[controllersKey] ??= new WeakMap());
}

export function hydrateDetail(
  root: HTMLElement,
  load: ProviderLoader = loadProvider,
): DetailController {
  const registry = controllers();
  const existing = registry.get(root);
  if (existing) return existing;
  const controller = { destroy };
  registry.set(root, controller);
  const abort = new AbortController();
  let handle: MapHandle | undefined;
  let observer: IntersectionObserver | undefined;
  let started = false;
  let disposed = false;
  let failed = false;
  const canvas = root.querySelector<HTMLElement>('[data-hpm-canvas]');

  function fail() {
    if (disposed) return;
    failed = true;
    if (canvas) canvas.tabIndex = -1;
    root.dataset.hpmActive = 'false';
    showFallback(root, true);
    setStatus(root, '地图暂时无法加载，请使用下方地点链接。');
    handle?.destroy();
  }
  const onPageHide = (event: PageTransitionEvent) => {
    // BFCache freezes this controller and its SDK ownership for the next pageshow.
    if (!event.persisted) destroy();
  };
  function destroy() {
    if (disposed) return;
    disposed = true;
    if (canvas) canvas.tabIndex = -1;
    if (registry.get(root) === controller) registry.delete(root);
    observer?.disconnect();
    abort.abort();
    handle?.destroy();
    window.removeEventListener('pagehide', onPageHide);
    root.dataset.hpmActive = 'false';
    showFallback(root, true);
  }
  let config: ReturnType<typeof readDetailConfig>;
  window.addEventListener('pagehide', onPageHide);
  try {
    config = readDetailConfig(root);
    if (!canvas) throw new Error('Missing map canvas');
    root.style.setProperty('--hpm-detail-height', config.height);
    canvas.tabIndex = -1;
    const names = config.map.points.map((point) => point.name).join('、');
    canvas.setAttribute('aria-label', `文章地点地图：${names}`);
  } catch {
    fail();
    return controller;
  }

  async function start() {
    if (started || disposed) return;
    started = true;
    observer?.disconnect();
    setStatus(root, '');
    try {
      const provider = await load(config);
      if (disposed) return;
      const mounted = await provider.mountDetail(canvas!, {
        map: config.map,
        defaultZoom: config.defaultZoom,
        signal: abort.signal,
        onError: fail,
      });
      if (disposed || failed) {
        mounted.destroy();
        return;
      }
      handle = mounted;
      handle.setInteractive(true);
      if (disposed || failed) return;
      canvas!.tabIndex = 0;
      root.dataset.hpmActive = 'true';
      showFallback(root, false);
      setStatus(root, '');
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
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', () => initializeDetailMaps(), { once: true });
else initializeDetailMaps();
