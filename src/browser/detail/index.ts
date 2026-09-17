import type { MapHandle, ProviderLoader } from '../providers/types';
import { readDetailConfig } from '../shared/config';
import { setStatus, showFallback } from '../shared/dom';
import { loadProvider } from '../shared/provider-loader';

export function hydrateDetail(
  root: HTMLElement,
  load: ProviderLoader = loadProvider,
): { destroy(): void } {
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
  function destroy() {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    abort.abort();
    handle?.destroy();
    activate.removeEventListener('click', onActivate);
    root.removeEventListener('keydown', onKey);
    window.removeEventListener('pagehide', destroy);
    activate.remove();
    root.dataset.hpmActive = 'false';
    showFallback(root, true);
  }
  let config: ReturnType<typeof readDetailConfig>;
  try {
    config = readDetailConfig(root);
    if (!canvas) throw new Error('Missing map canvas');
    root.style.setProperty('--hpm-detail-height', config.height);
    canvas.tabIndex = -1;
    canvas.setAttribute('aria-label', '文章地点地图，按 Esc 退出交互');
    canvas.insertAdjacentElement('afterend', activate);
  } catch {
    fail();
    return { destroy };
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
  window.addEventListener('pagehide', destroy, { once: true });
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
  return { destroy };
}

function initialize() {
  document
    .querySelectorAll<HTMLElement>('[data-hpm-detail]')
    .forEach((root) => hydrateDetail(root));
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();
