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
  const activate = document.createElement('button');
  activate.type = 'button';
  activate.className = 'hpm-detail__activate';
  activate.dataset.hpmActivate = '';
  activate.textContent = '点击或按 Enter 激活地图';
  activate.disabled = true;
  const canvas = root.querySelector<HTMLElement>('[data-hpm-canvas]');

  function fail() {
    if (disposed) return;
    failed = true;
    root.dataset.hpmActive = 'false';
    activate.hidden = true;
    showFallback(root, true);
    setStatus(root, '地图暂时无法加载，请使用下方地点链接。');
    handle?.destroy();
  }
  function interact(active: boolean) {
    if (!handle || failed || disposed) return;
    handle.setInteractive(active);
    if (failed) return;
    root.dataset.hpmActive = String(active);
    activate.hidden = active;
    if (active) {
      canvas?.focus();
      setStatus(root, '地图已激活，按 Esc 退出地图交互。');
    } else {
      activate.focus();
      setStatus(root, '地图加载完成，可激活地图交互。');
    }
  }
  const onActivate = () => interact(true);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') interact(false);
  };
  const onPageHide = (event: PageTransitionEvent) => {
    // BFCache freezes this controller and its SDK ownership for the next pageshow.
    if (!event.persisted) destroy();
  };
  function destroy() {
    if (disposed) return;
    disposed = true;
    if (registry.get(root) === controller) registry.delete(root);
    observer?.disconnect();
    abort.abort();
    handle?.destroy();
    activate.removeEventListener('click', onActivate);
    root.removeEventListener('keydown', onKey);
    window.removeEventListener('pagehide', onPageHide);
    activate.remove();
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
    canvas.setAttribute('aria-label', '文章地点地图，按 Esc 退出交互');
    canvas.insertAdjacentElement('afterend', activate);
  } catch {
    fail();
    return controller;
  }

  async function start() {
    if (started || disposed) return;
    started = true;
    observer?.disconnect();
    setStatus(root, '地图加载中…');
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
      showFallback(root, false);
      activate.disabled = false;
      setStatus(root, '地图加载完成，可激活地图交互。');
    } catch {
      fail();
    }
  }
  activate.addEventListener('click', onActivate);
  root.addEventListener('keydown', onKey);
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
