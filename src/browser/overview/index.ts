import { safeUrl } from '../../presentation/safe-html';
import type { OverviewPost } from '../../templates/overview';
import type {
  BrowserProviderConfig,
  FocusOriginResolver,
  OverviewMapHandle,
  OverviewProviderLoader,
} from '../providers/types';
import { registerRuntimeHydrator } from '../runtime/bridge';
import { FEATURES, type RuntimeController } from '../runtime/types';
import { setStatus, showFallback } from '../shared/dom';
import { installImageFallback } from './markers';
import { renderPostPanel, type PanelHandle } from './panel';
import { loadOverviewProvider } from './provider-loader';
import {
  createExplorationController,
  readBrowserExplorationConfig,
  type ExplorationController,
  type OverviewPanelPort,
} from './exploration';
import type { OverviewPanelState } from './exploration-types';

interface OverviewConfig extends BrowserProviderConfig {
  dataUrl: string;
  placeholderUrl: string;
  cluster: { gridSize: number; maxZoom: number };
}
const controllersKey = Symbol.for('hexo-post-map.overview-controllers.v1');
function controllers(): WeakMap<HTMLElement, RuntimeController> {
  const page = window as unknown as Record<
    symbol,
    WeakMap<HTMLElement, RuntimeController> | undefined
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
  load: OverviewProviderLoader = loadOverviewProvider,
  fetcher: typeof fetch = fetch,
): RuntimeController {
  const registry = controllers();
  const existing = registry.get(root);
  if (existing) return existing;
  const controller = { destroy, isCurrent };
  registry.set(root, controller);
  const abort = new AbortController();
  let handle: OverviewMapHandle | undefined;
  let exploration: ExplorationController | undefined;
  let panelState: OverviewPanelState = { mode: 'closed' };
  let panel: PanelHandle | undefined;
  let posts: readonly OverviewPost[] = [];
  let disposed = false;
  let failed = false;
  const cleanups: (() => void)[] = [];
  const canvas = root.querySelector<HTMLElement>('[data-hpm-canvas]');
  const data = root.querySelector('[data-hpm-data]');
  const dataText = data?.textContent;
  const toolbar = document.createElement('div');
  toolbar.className = 'hpm-overview__toolbar';
  toolbar.dataset.hpmToolbar = '';
  const showList = document.createElement('button');
  showList.type = 'button';
  showList.className = 'hpm-overview__list-toggle';
  showList.dataset.hpmShowList = '';
  showList.textContent = '全部文章 0';
  showList.hidden = true;
  showList.setAttribute('aria-expanded', 'false');
  toolbar.append(showList);
  root.append(toolbar);
  function isCurrent() {
    return (
      !disposed &&
      root.isConnected &&
      root.querySelector('[data-hpm-canvas]') === canvas &&
      root.querySelector('[data-hpm-data]') === data &&
      data?.textContent === dataText &&
      root.querySelector('[data-hpm-toolbar]') === toolbar &&
      toolbar.querySelector('[data-hpm-show-list]') === showList &&
      toolbar.parentElement === root
    );
  }
  function fail() {
    if (disposed || failed) return;
    failed = true;
    abort.abort();
    exploration?.destroy({ save: false });
    panel?.destroy('teardown');
    handle?.destroy();
    root.dataset.hpmActive = 'false';
    showList.hidden = true;
    showFallback(root, true);
    setStatus(root, '地图暂时无法加载，请使用下方文章列表。');
  }
  const onList = () => {
    if (showList.getAttribute('aria-expanded') === 'true') panel?.destroy();
    else select(posts, showList, () => showList);
  };
  function destroy() {
    if (disposed) return;
    exploration?.destroy({ save: !failed });
    disposed = true;
    if (registry.get(root) === controller) registry.delete(root);
    abort.abort();
    panel?.destroy('teardown');
    handle?.destroy();
    cleanups.forEach((cleanup) => cleanup());
    showList.removeEventListener('click', onList);
    toolbar.remove();
    root.dataset.hpmActive = 'false';
    showFallback(root, true);
  }
  let config: OverviewConfig;
  try {
    config = JSON.parse(data?.textContent ?? '') as OverviewConfig;
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
    focus = true,
    restored?: OverviewPanelState,
  ) {
    if (!isCurrent() || failed) return;
    panel?.destroy('replace');
    panelState =
      restored ??
      (origin === showList
        ? { mode: 'all', scroll: { top: 0 } }
        : posts.length === 1
          ? { mode: 'single', urls: [posts[0]!.url], scroll: { top: 0 } }
          : { mode: 'group', urls: posts.map((post) => post.url), scroll: { top: 0 } });
    panel = renderPostPanel(
      posts,
      window.matchMedia?.('(max-width: 600px)').matches ? 'mobile' : 'desktop',
      {
        container: root,
        placeholderUrl: config.placeholderUrl,
        origin,
        resolveOrigin,
        fallback: canvas ?? undefined,
        focusOnOpen: focus,
        onScroll: () => exploration?.changed({ scroll: true }),
        onClose: (reason) => {
          if (origin === showList) {
            showList.setAttribute('aria-expanded', 'false');
            showList.removeAttribute('aria-controls');
          }
          panel = undefined;
          if (reason === 'user') {
            panelState = { mode: 'closed' };
            exploration?.changed();
          }
        },
      },
    );
    if (restored && restored.mode !== 'closed') panel.restoreScroll(restored.scroll);
    if (origin === showList) {
      showList.setAttribute('aria-expanded', 'true');
      showList.setAttribute('aria-controls', panel.element.id);
    }
    exploration?.changed();
  }
  const panelPort: OverviewPanelPort = {
    read() {
      return panelState.mode === 'closed' || !panel
        ? { mode: 'closed' }
        : { ...panelState, scroll: panel.getScroll() };
    },
    open(state, options) {
      if (state.mode === 'closed') return;
      const selected =
        state.mode === 'all'
          ? posts
          : state.urls
              .map((url) => posts.find((post) => post.url === url))
              .filter((post): post is OverviewPost => !!post);
      select(
        selected,
        options.origin ?? (state.mode === 'all' ? showList : canvas!),
        options.resolveOrigin,
        options.focus,
        state,
      );
    },
  };
  async function start() {
    setStatus(root, '');
    try {
      const response = await fetcher(config.dataUrl, { signal: abort.signal });
      if (!isCurrent() || failed) return;
      if (!response.ok) throw new Error('Overview fetch failed');
      const data: unknown = await response.json();
      if (!isCurrent() || failed) return;
      posts = readPosts(data);
      if (posts.length === 0) {
        setStatus(
          root,
          root.querySelector('[data-hpm-empty]')?.textContent ?? '暂无标注地点的文章。',
        );
        return;
      }
      const provider = await load(config);
      if (!isCurrent() || failed) return;
      const settings = readBrowserExplorationConfig(config, window.location.origin);
      if (settings)
        exploration = createExplorationController({
          root,
          canvas: canvas!,
          toolbar,
          showList,
          ...settings,
          dataUrl: config.dataUrl,
          maxZoom: config.cluster.maxZoom,
          posts,
          panel: panelPort,
          isCurrent,
        });
      const mounted = await provider.mountOverview(canvas!, {
        posts,
        ...config.cluster,
        placeholderUrl: config.placeholderUrl,
        initialView: exploration?.initialView,
        signal: abort.signal,
        onError: fail,
        onPostSelect: (post, origin, resolveOrigin) => select([post], origin, resolveOrigin),
        onGroupSelect: (posts, origin, resolveOrigin) => select(posts, origin, resolveOrigin),
      });
      if (!isCurrent() || failed) {
        exploration?.destroy({ save: false });
        mounted.destroy();
        return;
      }
      handle = mounted;
      handle.setInteractive(true);
      if (!isCurrent() || failed) return;
      exploration?.activate(handle);
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
  load: OverviewProviderLoader = loadOverviewProvider,
  fetcher: typeof fetch = fetch,
): void {
  scope
    .querySelectorAll<HTMLElement>('[data-hpm-overview]')
    .forEach((root) => hydrateOverview(root, load, fetcher));
}
registerRuntimeHydrator({
  id: 'overview',
  selector: FEATURES.overview.selector,
  mount: hydrateOverview,
});
