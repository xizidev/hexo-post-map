import type { Coordinate } from '../../domain/types';
import type { OverviewPost } from '../../templates/overview';
import { decideClusterAction, type Bounds } from '../overview/cluster-decision';
import { createClusterMarker, createImageMarker, overviewFitPadding } from '../overview/markers';
import {
  AMAP_LOAD_TIMEOUT_MS,
  amapInteraction,
  loadAMapApi,
  type AMapSdkApi,
  type AMapSdkMap,
} from './amap-sdk';
import type {
  BrowserProviderConfig,
  MapHandle,
  OverviewMapOptions,
  OverviewMapProvider,
} from './types';

interface ClusterPoint {
  lnglat: number[];
  post: OverviewPost;
  postId: number;
}
interface ClusterMarker {
  setContent(content: HTMLElement): void;
  setOffset(offset: unknown): void;
}
interface ClusterContext {
  marker: ClusterMarker;
  clusterData?: ClusterPoint[];
  data?: ClusterPoint[];
}
interface ClusterOptions {
  gridSize: number;
  maxZoom: number;
  renderClusterMarker(context: ClusterContext): void;
  renderMarker(context: ClusterContext): void;
}
interface AMapOverviewApi extends AMapSdkApi {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapSdkMap;
  Bounds: new (southwest: Coordinate, northeast: Coordinate) => unknown;
  Pixel: new (x: number, y: number) => unknown;
  plugin(names: string[], ready: () => void): void;
  MarkerCluster?: new (
    map: AMapSdkMap,
    data: ClusterPoint[],
    options: ClusterOptions,
  ) => { setMap(map: AMapSdkMap | null): void };
}

function loadCluster(api: AMapOverviewApi, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Map initialization cancelled'));
      return;
    }
    if (api.MarkerCluster) {
      resolve();
      return;
    }
    let settled = false;
    const timer = window.setTimeout(
      () => finish(new Error('Map plugin loading timed out')),
      AMAP_LOAD_TIMEOUT_MS,
    );
    const cancel = () => finish(new Error('Map initialization cancelled'));
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve();
    }
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      api.plugin(['AMap.MarkerCluster'], () => {
        if (settled) return;
        finish(api.MarkerCluster ? undefined : new Error('Map plugin unavailable'));
      });
    } catch {
      finish(new Error('Map plugin unavailable'));
    }
  });
}

function postBounds(posts: readonly OverviewPost[]): Bounds {
  return posts.reduce(
    (bounds, post) => ({
      west: Math.min(bounds.west, post.location.longitude),
      east: Math.max(bounds.east, post.location.longitude),
      south: Math.min(bounds.south, post.location.latitude),
      north: Math.max(bounds.north, post.location.latitude),
    }),
    { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity },
  );
}

async function mountOverview(
  api: AMapOverviewApi,
  mapStyle: string,
  container: HTMLElement,
  options: OverviewMapOptions,
): Promise<MapHandle> {
  if (!Number.isFinite(options.maxZoom) || options.maxZoom < 2 || options.maxZoom > 20)
    throw new Error('Invalid overview maximum zoom');
  await loadCluster(api, options.signal);
  if (options.signal?.aborted) throw new Error('Map initialization cancelled');
  if (!options.posts.length) throw new Error('Missing overview posts');
  // AMap can collapse exact-coordinate duplicates in renderer data. Preserve the
  // full article membership ourselves instead of trusting the representative list.
  const coordinateGroups = new Map<string, number[]>();
  const groupsByPostId = options.posts.map((post, postId) => {
    const key = `${post.location.longitude},${post.location.latitude}`;
    let members = coordinateGroups.get(key);
    if (!members) coordinateGroups.set(key, (members = []));
    members.push(postId);
    return members;
  });
  return new Promise((resolve, reject) => {
    const compactMedia = window.matchMedia?.('(max-width: 600px)');
    const map = new api.Map(container, {
      zoom: Math.min(4, options.maxZoom),
      mapStyle,
      // Keep overlapping points clustered at the terminal level, including manual zooming.
      zooms: [2, options.maxZoom],
      ...amapInteraction(false),
      animateEnable: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    });
    let destroyed = false;
    let complete = false;
    let active = false;
    let cluster: { setMap(map: AMapSdkMap | null): void } | undefined;
    interface RenderedButton {
      marker: ClusterMarker;
      key: string;
      button: HTMLButtonElement;
      onClick: (event: MouseEvent) => void;
      awaitingMount: boolean;
      post?: OverviewPost;
    }
    const buttons = new Map<HTMLButtonElement, RenderedButton>();
    const previousButtons = new WeakMap<ClusterMarker, RenderedButton>();
    const currentButtons = new Map<string, RenderedButton>();
    const leafOffsets = new Map<boolean, readonly [x: number, y: number]>();
    let sweepFrame: number | undefined;
    function release(entry: RenderedButton) {
      buttons.delete(entry.button);
      if (previousButtons.get(entry.marker) === entry) previousButtons.delete(entry.marker);
      if (currentButtons.get(entry.key) === entry) currentButtons.delete(entry.key);
      entry.button.removeEventListener('click', entry.onClick);
      entry.button.disabled = true;
      entry.button.tabIndex = -1;
    }
    function scheduleSweep() {
      if (destroyed || sweepFrame !== undefined) return;
      sweepFrame = window.requestAnimationFrame(() => {
        sweepFrame = undefined;
        let pending = false;
        for (const entry of buttons.values()) {
          if (container.contains(entry.button)) entry.awaitingMount = false;
          else if (entry.awaitingMount) {
            // The SDK can attach content after its renderer returns, even on the next frame.
            entry.awaitingMount = false;
            pending = true;
          } else release(entry);
        }
        if (pending) scheduleSweep();
      });
    }
    // There is no public cluster redraw-complete event. Observe actual canvas membership instead.
    const observer = new MutationObserver(scheduleSweep);
    observer.observe(container, { childList: true, subtree: true });
    const timer = window.setTimeout(fail, AMAP_LOAD_TIMEOUT_MS);
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(timer);
      map.off('complete', ready);
      map.off('error', fail);
      compactMedia?.removeEventListener('change', reanchorLeaves);
      options.signal?.removeEventListener('abort', cancel);
      observer.disconnect();
      if (sweepFrame !== undefined) window.cancelAnimationFrame(sweepFrame);
      buttons.forEach(release);
      cluster?.setMap(null);
      map.destroy();
    }
    function fail() {
      if (destroyed) return;
      destroy();
      if (complete) options.onError?.();
      else reject(new Error('Map initialization failed'));
    }
    function cancel() {
      destroy();
      if (!complete) reject(new Error('Map initialization cancelled'));
    }
    function fit(bounds: Bounds) {
      // AMap also gates programmatic fit zooms on zoomEnable. Initial fitting
      // happens before activation, so temporarily permit it without enabling
      // wheel, touch or keyboard interaction, then restore the current state.
      map.setStatus({ zoomEnable: true });
      try {
        map.setBounds(
          new api.Bounds([bounds.west, bounds.south], [bounds.east, bounds.north]),
          true,
          overviewFitPadding,
        );
      } finally {
        map.setStatus({ zoomEnable: active });
      }
    }
    function ready() {
      if (destroyed || complete) return;
      try {
        fit(postBounds(options.posts));
        clearTimeout(timer);
        complete = true;
        resolve({
          destroy,
          setInteractive(enabled) {
            if (destroyed) return;
            try {
              active = enabled;
              map.setStatus(amapInteraction(enabled));
              buttons.forEach(({ button }) => {
                button.disabled = !enabled;
                button.tabIndex = enabled ? 0 : -1;
              });
            } catch {
              fail();
            }
          },
        });
      } catch {
        fail();
      }
    }
    function reanchorLeaves(event: MediaQueryListEvent) {
      if (destroyed) return;
      try {
        const leaves = Array.from(buttons.values()).filter(
          (entry): entry is RenderedButton & { post: OverviewPost } => entry.post !== undefined,
        );
        if (!leaves.length) return;
        const offset =
          leafOffsets.get(event.matches) ??
          createImageMarker(leaves[0]!.post, options.placeholderUrl, event.matches).offset;
        leafOffsets.set(event.matches, offset);
        leaves.forEach(({ marker }) => marker.setOffset(new api.Pixel(...offset)));
      } catch {
        fail();
      }
    }
    function render(context: ClusterContext, grouped: boolean) {
      if (destroyed) return;
      try {
        const points = grouped ? context.clusterData : context.data;
        const postIds = [
          ...new Set(points?.map((point) => groupsByPostId[point.postId] ?? [])),
        ].flat();
        const posts = postIds.map((postId) => options.posts[postId]!);
        if (!posts.length) throw new Error('Missing cluster data');
        const isGroup = posts.length > 1;
        // Stable membership survives vendor marker replacement and renderer ordering changes.
        const key = postIds.sort((a, b) => a - b).join(',');
        const old = previousButtons.get(context.marker);
        if (old) release(old);
        const replacement = currentButtons.get(key);
        if (replacement) release(replacement);
        const compact = compactMedia?.matches ?? false;
        const view = isGroup
          ? createClusterMarker(posts.length)
          : createImageMarker(posts[0]!, options.placeholderUrl, compact);
        if (!isGroup) leafOffsets.set(compact, view.offset);
        const button = view.element;
        button.disabled = !active;
        button.tabIndex = active ? 0 : -1;
        const resolveOrigin = () => {
          const current = currentButtons.get(key)?.button;
          return !destroyed && current?.isConnected && !current.disabled ? current : undefined;
        };
        const onClick = (event: MouseEvent) => {
          event.stopPropagation();
          if (destroyed || !active || button.disabled) return;
          try {
            if (!isGroup) {
              options.onPostSelect(posts[0]!, button, resolveOrigin);
              return;
            }
            const zoom = map.getZoom();
            const decision = decideClusterAction({
              zoom,
              maxZoom: options.maxZoom,
              posts,
              bounds: postBounds(posts),
            });
            if (decision.type === 'zoom') {
              fit(decision.bounds);
              // A large pixel grid may retain the same members after fitting; always advance.
              if (!destroyed && map.getZoom() <= zoom)
                map.setZoom(Math.min(zoom + 1, options.maxZoom), true);
            } else options.onGroupSelect(decision.posts, button, resolveOrigin);
          } catch {
            fail();
          }
        };
        button.addEventListener('click', onClick);
        const entry = {
          marker: context.marker,
          key,
          button,
          onClick,
          awaitingMount: true,
          post: isGroup ? undefined : posts[0],
        };
        previousButtons.set(context.marker, entry);
        currentButtons.set(key, entry);
        buttons.set(button, entry);
        context.marker.setContent(button);
        context.marker.setOffset(new api.Pixel(...view.offset));
        scheduleSweep();
      } catch {
        fail();
      }
    }
    map.on('complete', ready);
    map.on('error', fail);
    compactMedia?.addEventListener('change', reanchorLeaves);
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      cluster = new api.MarkerCluster!(
        map,
        options.posts.map((post, postId) => ({
          lnglat: [post.location.longitude, post.location.latitude],
          post,
          postId,
        })),
        {
          gridSize: options.gridSize,
          maxZoom: options.maxZoom,
          renderClusterMarker: (context) => render(context, true),
          renderMarker: (context) => render(context, false),
        },
      );
      // A renderer can fail synchronously inside the vendor constructor.
      if (destroyed) cluster.setMap(null);
    } catch {
      fail();
    }
  });
}

export async function createAMapOverviewProvider(
  config: BrowserProviderConfig,
): Promise<OverviewMapProvider> {
  const api = await loadAMapApi<AMapOverviewApi>(config);
  return {
    mountOverview: (container, options) =>
      mountOverview(api, config.amap.mapStyle, container, options),
  };
}
