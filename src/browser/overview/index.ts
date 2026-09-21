import { safeUrl } from '../../presentation/safe-html';
import type { OverviewPost } from '../../templates/overview';
import type {
  BrowserProviderConfig,
  FocusOriginResolver,
  MapHandle,
  ProviderLoader,
} from '../providers/types';
import { setStatus, showFallback } from '../shared/dom';
import { loadProvider } from '../shared/provider-loader';
import { installImageFallback } from './markers';
import { renderPostPanel, type PanelHandle } from './panel';

interface OverviewController {
  destroy(): void;
}
interface OverviewConfig extends BrowserProviderConfig {
  dataUrl: string;
  placeholderUrl: string;
  cluster: { gridSize: number; maxZoom: number };
}
const controllersKey = Symbol.for('hexo-post-map.overview-controllers.v1');
function controllers(): WeakMap<HTMLElement, OverviewController> {
  const page = window as unknown as Record<
    symbol,
    WeakMap<HTMLElement, OverviewController> | undefined
  >;
  return (page[controllersKey] ??= new WeakMap());
}
function readPosts(value: unknown): OverviewPost[] {
  if (!value || typeof value !== 'object') throw new Error('Invalid overview data');
  const envelope = value as { version?: unknown; posts?: unknown };
  if (envelope.version !== 1 || !Array.isArray(envelope.posts))
    throw new Error('Invalid overview version');
  for (const value of envelope.posts) {
    if (!value || typeof value !== 'object') throw new Error('Invalid post');
    const post = value as OverviewPost;
    if (
      !['title', 'url', 'date', 'image'].every(
        (key) => typeof Reflect.get(post, key) === 'string',
      ) ||
      !Number.isFinite(Date.parse(post.date)) ||
      !post.location ||
      typeof post.location.name !== 'string' ||
      !Number.isFinite(post.location.longitude) ||
      Math.abs(post.location.longitude) > 180 ||
      !Number.isFinite(post.location.latitude) ||
      Math.abs(post.location.latitude) > 90
    )
      throw new Error('Invalid post');
  }
  return envelope.posts as OverviewPost[];
}

export function hydrateOverview(
  root: HTMLElement,
  load: ProviderLoader = loadProvider,
  fetcher: typeof fetch = fetch,
): OverviewController {
  const registry = controllers();
  const existing = registry.get(root);
  if (existing) return existing;
  const controller = { destroy };
  registry.set(root, controller);
  const abort = new AbortController();
  let handle: MapHandle | undefined;
  let panel: PanelHandle | undefined;
  let posts: readonly OverviewPost[] = [];
  let disposed = false;
  let failed = false;
  const cleanups: (() => void)[] = [];
  const canvas = root.querySelector<HTMLElement>('[data-hpm-canvas]');
  const showList = document.createElement('button');
  showList.type = 'button';
  showList.className = 'hpm-overview__list-toggle';
  showList.dataset.hpmShowList = '';
  showList.textContent = '全部文章 0';
  showList.hidden = true;
  showList.setAttribute('aria-expanded', 'false');
  function fail() {
    if (disposed || failed) return;
    failed = true;
    abort.abort();
    panel?.destroy();
    handle?.destroy();
    root.dataset.hpmActive = 'false';
    showList.hidden = true;
    showFallback(root, true);
    setStatus(root, '地图暂时无法加载，请使用下方文章列表。');
  }
  const onPageHide = (event: PageTransitionEvent) => {
    // BFCache freezes this controller and its SDK ownership for the next pageshow.
    if (!event.persisted) destroy();
  };
  const onList = () => {
    if (showList.getAttribute('aria-expanded') === 'true') panel?.destroy();
    else select(posts, showList, () => showList);
  };
  function destroy() {
    if (disposed) return;
    disposed = true;
    if (registry.get(root) === controller) registry.delete(root);
    abort.abort();
    panel?.destroy();
    handle?.destroy();
    cleanups.forEach((cleanup) => cleanup());
    showList.removeEventListener('click', onList);
    window.removeEventListener('pagehide', onPageHide);
    showList.remove();
    root.dataset.hpmActive = 'false';
    showFallback(root, true);
  }
  window.addEventListener('pagehide', onPageHide);
  let config: OverviewConfig;
  try {
    config = JSON.parse(root.querySelector('[data-hpm-data]')?.textContent ?? '') as OverviewConfig;
    if (
      !canvas ||
      config.provider !== 'amap' ||
      !config.amap?.key ||
      typeof config.dataUrl !== 'string' ||
      !safeUrl(config.dataUrl, 'post') ||
      typeof config.placeholderUrl !== 'string' ||
      !safeUrl(config.placeholderUrl, 'image') ||
      !Number.isFinite(config.cluster?.gridSize) ||
      config.cluster.gridSize <= 0 ||
      !Number.isFinite(config.cluster.maxZoom) ||
      config.cluster.maxZoom < 2 ||
      config.cluster.maxZoom > 20
    )
      throw new Error('Invalid map configuration');
    canvas.tabIndex = -1;
    canvas.setAttribute('aria-label', '文章地图');
    root.append(showList);
    root
      .querySelectorAll<HTMLImageElement>('[data-hpm-image]')
      .forEach((image) => cleanups.push(installImageFallback(image, config.placeholderUrl)));
  } catch {
    fail();
    return controller;
  }
  showList.addEventListener('click', onList);
  function select(
    posts: readonly OverviewPost[],
    origin: HTMLElement,
    resolveOrigin?: FocusOriginResolver,
  ) {
    if (disposed || failed) return;
    panel?.destroy();
    panel = renderPostPanel(
      posts,
      window.matchMedia?.('(max-width: 600px)').matches ? 'mobile' : 'desktop',
      {
        container: root,
        placeholderUrl: config.placeholderUrl,
        origin,
        resolveOrigin,
        fallback: canvas ?? undefined,
        onClose: () => {
          if (origin === showList) {
            showList.setAttribute('aria-expanded', 'false');
            showList.removeAttribute('aria-controls');
          }
          panel = undefined;
        },
      },
    );
    if (origin === showList) {
      showList.setAttribute('aria-expanded', 'true');
      showList.setAttribute('aria-controls', panel.element.id);
    }
  }
  async function start() {
    setStatus(root, '');
    try {
      const response = await fetcher(config.dataUrl, { signal: abort.signal });
      if (disposed || failed) return;
      if (!response.ok) throw new Error('Overview fetch failed');
      const data: unknown = await response.json();
      if (disposed || failed) return;
      posts = readPosts(data);
      if (posts.length === 0) {
        setStatus(
          root,
          root.querySelector('[data-hpm-empty]')?.textContent ?? '暂无标注地点的文章。',
        );
        return;
      }
      const provider = await load(config);
      if (disposed || failed) return;
      const mounted = await provider.mountOverview(canvas!, {
        posts,
        ...config.cluster,
        placeholderUrl: config.placeholderUrl,
        signal: abort.signal,
        onError: fail,
        onPostSelect: (post, origin, resolveOrigin) => select([post], origin, resolveOrigin),
        onGroupSelect: select,
      });
      if (disposed || failed) {
        mounted.destroy();
        return;
      }
      handle = mounted;
      handle.setInteractive(true);
      if (disposed || failed) return;
      root.dataset.hpmActive = 'true';
      showFallback(root, false);
      showList.textContent = `全部文章 ${posts.length}`;
      showList.hidden = false;
      setStatus(root, '');
    } catch {
      fail();
    }
  }
  void start();
  return controller;
}

export function initializeOverviewMaps(
  scope: ParentNode = document,
  load: ProviderLoader = loadProvider,
  fetcher: typeof fetch = fetch,
): void {
  scope
    .querySelectorAll<HTMLElement>('[data-hpm-overview]')
    .forEach((root) => hydrateOverview(root, load, fetcher));
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', () => initializeOverviewMaps(), { once: true });
else initializeOverviewMaps();
