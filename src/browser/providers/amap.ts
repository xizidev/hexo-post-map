import AMapLoader from '@amap/amap-jsapi-loader';
import type { Coordinate } from '../../domain/types';
import type { OverviewPost } from '../../templates/overview';
import { decideClusterAction, type Bounds } from '../overview/cluster-decision';
import { createClusterMarker, createImageMarker } from '../overview/markers';
import type {
  BrowserProviderConfig,
  DetailMapModel,
  MapHandle,
  MapProvider,
  OverviewMapOptions,
} from './types';

// Local structural types deliberately keep all vendor API details inside the adapter.
interface AMapMap {
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
  add(overlays: unknown[]): void;
  setFitView(overlays: unknown[], immediately: boolean, padding: number[]): void;
  setStatus(status: Record<string, boolean>): void;
  destroy(): void;
  getZoom(): number;
  setZoom(zoom: number, immediately: boolean): void;
  setBounds(bounds: unknown, immediately: boolean, padding: number[]): void;
}
interface AMapApi {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapMap;
  Marker: new (options: Record<string, unknown>) => unknown;
  Polyline: new (options: Record<string, unknown>) => unknown;
  Bounds: new (southwest: Coordinate, northeast: Coordinate) => unknown;
  Pixel: new (x: number, y: number) => unknown;
  plugin(names: string[], ready: () => void): void;
  MarkerCluster?: new (
    map: AMapMap,
    data: ClusterPoint[],
    options: ClusterOptions,
  ) => { setMap(map: AMapMap | null): void };
}
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
const loader = AMapLoader as unknown as {
  load(options: { key: string; version: string }): Promise<AMapApi>;
  reset(): void;
};
const LOAD_TIMEOUT_MS = 20_000;
const attemptKey = Symbol.for('hexo-post-map.amap-attempt.v1');
const terminalKey = Symbol.for('hexo-post-map.amap-terminal.v1');

// A timed-out JSONP response may still execute. Keep one inert callback, without attempt state.
function ignoreLateApiResponse(): void {}

function existingApi(value: unknown): value is AMapApi {
  if (value === null || typeof value !== 'object') return false;
  const api = value as Record<string, unknown>;
  return (
    typeof api.version === 'string' &&
    /^2(?:\.|$)/u.test(api.version) &&
    ['Map', 'Marker', 'Polyline'].every((name) => typeof api[name] === 'function')
  );
}

function isSdkScript(script: HTMLScriptElement): boolean {
  return /^https:\/\/webapi\.amap\.com\/maps(?:\?|$)/u.test(script.src);
}

/** Own only the request started here, never an SDK or configuration belonging to the theme. */
function loadApi(config: BrowserProviderConfig): Promise<AMapApi> {
  if (Reflect.get(window, terminalKey)) {
    return Promise.reject(new Error('Map SDK loading timed out; reload page to retry'));
  }
  const currentApi: unknown = Reflect.get(window, 'AMap');
  if (currentApi !== undefined) {
    return existingApi(currentApi)
      ? Promise.resolve(currentApi)
      : Promise.reject(new Error('Cannot reuse existing map SDK'));
  }
  if (
    Reflect.get(window, attemptKey) ||
    ['AMapUI', 'Loca', '___onAPILoaded'].some((key) => Reflect.get(window, key) !== undefined) ||
    Array.from(document.scripts).some(isSdkScript)
  ) {
    return Promise.reject(new Error('Cannot take ownership of existing map SDK loading state'));
  }
  const previousSecurity = Object.getOwnPropertyDescriptor(window, '_AMapSecurityConfig');
  const security =
    config.amap.serviceHost !== undefined
      ? { serviceHost: config.amap.serviceHost }
      : { securityJsCode: config.amap.securityJsCode };
  const attempt = {};
  const scriptsBefore = new Set(document.scripts);
  return new Promise((resolve, reject) => {
    let settled = false;
    let ownedScripts: HTMLScriptElement[] = [];
    let ownedCallback: unknown;
    const timer = window.setTimeout(
      () => fail(new Error('Map SDK loading timed out; reload page to retry'), true),
      LOAD_TIMEOUT_MS,
    );
    const ownsAttempt = () => Reflect.get(window, attemptKey) === attempt;
    function release() {
      clearTimeout(timer);
      if (ownsAttempt()) Reflect.deleteProperty(window, attemptKey);
    }
    function fail(error: unknown, terminal = false) {
      if (settled) return;
      settled = true;
      if (terminal) Reflect.set(window, terminalKey, true);
      if (ownsAttempt()) {
        const ownsSecurity = Reflect.get(window, '_AMapSecurityConfig') === security;
        const currentCallback: unknown = Reflect.get(window, '___onAPILoaded');
        const ownsCallback = currentCallback === undefined || currentCallback === ownedCallback;
        ownedScripts.forEach((script) => script.remove());
        if (currentCallback === ownedCallback && ownedCallback !== undefined) {
          if (terminal) Reflect.set(window, '___onAPILoaded', ignoreLateApiResponse);
          else Reflect.deleteProperty(window, '___onAPILoaded');
        }
        // reset() deletes all three SDK globals. Only use it while none has been supplied by another owner.
        if (
          !terminal &&
          ownsSecurity &&
          ownsCallback &&
          ['AMap', 'AMapUI', 'Loca'].every((key) => Reflect.get(window, key) === undefined)
        )
          loader.reset();
        if (ownsSecurity) {
          if (previousSecurity)
            Object.defineProperty(window, '_AMapSecurityConfig', previousSecurity);
          else Reflect.deleteProperty(window, '_AMapSecurityConfig');
        }
      }
      release();
      reject(error);
    }
    try {
      if (
        !Reflect.defineProperty(window, '_AMapSecurityConfig', {
          configurable: previousSecurity?.configurable ?? true,
          enumerable: previousSecurity?.enumerable ?? true,
          writable: true,
          value: security,
        })
      )
        throw new Error('Cannot configure map SDK');
      Reflect.set(window, attemptKey, attempt);
      const pending = loader.load({ key: config.amap.key, version: '2.0' });
      ownedScripts = Array.from(document.scripts).filter(
        (script) => !scriptsBefore.has(script) && isSdkScript(script),
      );
      const callback: unknown = Reflect.get(window, '___onAPILoaded');
      if (typeof callback === 'function') {
        ownedCallback = (...args: unknown[]) => {
          if (!settled && ownsAttempt()) Reflect.apply(callback, window, args);
        };
        Reflect.set(window, '___onAPILoaded', ownedCallback);
      }
      pending.then((api) => {
        if (settled) return;
        const installed: unknown = Reflect.get(window, 'AMap');
        if (!ownsAttempt() || (installed !== undefined && installed !== api)) {
          fail(new Error('Map SDK ownership changed during loading'));
          return;
        }
        settled = true;
        release();
        resolve(api);
      }, fail);
    } catch (error) {
      fail(error);
    }
  });
}

function interaction(active: boolean): Record<string, boolean> {
  return {
    scrollWheel: active,
    touchZoom: active,
    dragEnable: active,
    keyboardEnable: active,
    doubleClickZoom: active,
    zoomEnable: active,
    rotateEnable: false,
  };
}

function mountDetail(
  api: AMapApi,
  container: HTMLElement,
  model: DetailMapModel,
): Promise<MapHandle> {
  return new Promise((resolve, reject) => {
    if (model.signal?.aborted) {
      reject(new Error('Map initialization cancelled'));
      return;
    }
    const point = model.map.points[0];
    if (!point) {
      reject(new Error('Missing map points'));
      return;
    }
    const map = new api.Map(container, {
      center: point.coordinate,
      zoom: model.map.zoom ?? model.defaultZoom,
      ...interaction(false),
      animateEnable: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    });
    let complete = false;
    let destroyed = false;
    const markers: unknown[] = [];
    const timeout = window.setTimeout(fail, LOAD_TIMEOUT_MS);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(timeout);
      map.off('complete', ready);
      map.off('error', fail);
      model.signal?.removeEventListener('abort', cancel);
      map.destroy();
    }
    function fail() {
      if (destroyed) return;
      destroy();
      if (complete) model.onError?.();
      else reject(new Error('Map initialization failed'));
    }
    function cancel() {
      destroy();
      if (!complete) reject(new Error('Map initialization cancelled'));
    }
    function ready() {
      if (destroyed || complete) return;
      try {
        if (markers.length > 1) map.setFitView(markers, true, [24, 24, 24, 24]);
        clearTimeout(timeout);
        complete = true;
        resolve({
          destroy,
          setInteractive(active) {
            if (destroyed) return;
            try {
              map.setStatus(interaction(active));
            } catch {
              fail();
            }
          },
        });
      } catch {
        fail();
      }
    }
    map.on('complete', ready);
    map.on('error', fail);
    model.signal?.addEventListener('abort', cancel, { once: true });

    try {
      for (const point of model.map.points) {
        const marker = document.createElement('span');
        marker.className = 'hpm-detail-marker';
        marker.setAttribute('aria-hidden', 'true');
        const sequence = model.map.route.findIndex((item) => item.id === point.id);
        if (sequence >= 0) {
          marker.classList.add('hpm-detail-marker--numbered');
          const label = document.createElement('span');
          label.className = 'hpm-detail-marker__label';
          label.textContent = String(sequence + 1);
          marker.append(label);
        }
        markers.push(
          new api.Marker({ position: point.coordinate, content: marker, anchor: 'bottom-center' }),
        );
      }
      const overlays = [...markers];
      if (model.map.route.length > 1)
        overlays.push(
          new api.Polyline({
            path: model.map.route.map((point) => point.coordinate),
            strokeColor:
              getComputedStyle(container).getPropertyValue('--hpm-route-color').trim() || '#0f766e',
            strokeWeight: 3,
          }),
        );
      map.add(overlays);
    } catch {
      fail();
    }
  });
}

function loadCluster(api: AMapApi, signal?: AbortSignal): Promise<void> {
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
      LOAD_TIMEOUT_MS,
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
  api: AMapApi,
  container: HTMLElement,
  options: OverviewMapOptions,
): Promise<MapHandle> {
  if (!Number.isFinite(options.maxZoom) || options.maxZoom < 2 || options.maxZoom > 20)
    throw new Error('Invalid overview maximum zoom');
  await loadCluster(api, options.signal);
  if (options.signal?.aborted) throw new Error('Map initialization cancelled');
  if (!options.posts.length) throw new Error('Missing overview posts');
  return new Promise((resolve, reject) => {
    const compactMedia = window.matchMedia?.('(max-width: 600px)');
    const map = new api.Map(container, {
      zoom: Math.min(4, options.maxZoom),
      // Keep overlapping points clustered at the terminal level, including manual zooming.
      zooms: [2, options.maxZoom],
      ...interaction(false),
      animateEnable: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    });
    let destroyed = false;
    let complete = false;
    let active = false;
    let cluster: { setMap(map: AMapMap | null): void } | undefined;
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
    const timer = window.setTimeout(fail, LOAD_TIMEOUT_MS);
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
      map.setBounds(
        new api.Bounds([bounds.west, bounds.south], [bounds.east, bounds.north]),
        true,
        [48, 48, 48, 48],
      );
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
              map.setStatus(interaction(enabled));
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
        const posts = points?.map((point) => point.post);
        if (!posts?.length) throw new Error('Missing cluster data');
        // Stable membership survives vendor marker replacement and renderer ordering changes.
        const key = points!
          .map((point) => point.postId)
          .sort((a, b) => a - b)
          .join(',');
        const old = previousButtons.get(context.marker);
        if (old) release(old);
        const replacement = currentButtons.get(key);
        if (replacement) release(replacement);
        const compact = compactMedia?.matches ?? false;
        const view = grouped
          ? createClusterMarker(posts.length)
          : createImageMarker(posts[0]!, options.placeholderUrl, compact);
        if (!grouped) leafOffsets.set(compact, view.offset);
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
            if (!grouped) {
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
          post: grouped ? undefined : posts[0],
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

export async function createAMapProvider(config: BrowserProviderConfig): Promise<MapProvider> {
  const api = await loadApi(config);
  return {
    mountDetail: (container, model) => mountDetail(api, container, model),
    mountOverview: (container, options) => mountOverview(api, container, options),
  };
}
