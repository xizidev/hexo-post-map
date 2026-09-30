import type { Coordinate } from '../../domain/types';
import type { OverviewPost } from '../../templates/overview';
import { decideClusterAction, type Bounds } from '../overview/cluster-decision';
import { createClusterMarker, createImageMarker, overviewFitPadding } from '../overview/markers';
import { createDetailMarker, type DetailMarkerElement } from '../detail/marker';
import {
  convertTrackFromGps,
  createTrackProgressGeometry,
  type AMapTrackConversionApi,
} from './amap-track';
import {
  AMAP_LOAD_TIMEOUT_MS as LOAD_TIMEOUT_MS,
  amapInteraction as interaction,
  loadAMapApi,
  type AMapSdkApi,
} from './amap-sdk';
import type {
  BrowserProviderConfig,
  DetailMapHandle,
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
  remove?(overlays: unknown[]): void;
  setFitView(overlays: unknown[], immediately: boolean, padding: number[]): void;
  setStatus(status: Record<string, boolean>): void;
  destroy(): void;
  getZoom(): number;
  setZoom(zoom: number, immediately: boolean): void;
  setBounds(bounds: unknown, immediately: boolean, padding: number[]): void;
}
interface AMapMarker {
  setTop(top: boolean): void;
  setPosition(position: Coordinate): void;
  setMap?(map: AMapMap | null): void;
}
interface AMapPolyline {
  setPath(path: readonly Coordinate[]): void;
  hide(): void;
  show(): void;
  setMap?(map: AMapMap | null): void;
}
interface AMapApi extends AMapSdkApi {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapMap;
  Marker: new (options: Record<string, unknown>) => AMapMarker;
  Polyline: new (options: Record<string, unknown>) => AMapPolyline;
  Bounds: new (southwest: Coordinate, northeast: Coordinate) => unknown;
  Pixel: new (x: number, y: number) => unknown;
  plugin(names: string[], ready: () => void): void;
  convertFrom?: AMapTrackConversionApi['convertFrom'];
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
function mountDetail(
  api: AMapApi,
  mapStyle: string,
  container: HTMLElement,
  model: DetailMapModel,
): Promise<DetailMapHandle> {
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
      mapStyle,
      ...interaction(false),
      animateEnable: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    });
    let complete = false;
    let mapReady = false;
    let trackReady = model.track === undefined;
    let trackMounted = false;
    let trackErrorReported = false;
    let destroyed = false;
    const markers: AMapMarker[] = [];
    const fullTrackLines: AMapPolyline[] = [];
    const progressTrackLines: AMapPolyline[] = [];
    const trackOverlays: Array<AMapPolyline | AMapMarker> = [];
    let movingTrackMarker: AMapMarker | undefined;
    let updateTrackProgress: ((progress: number) => void) | undefined;
    let schematicRoute: AMapPolyline | undefined;
    const trackAbort = model.track ? new AbortController() : undefined;
    const markerViews: Array<
      DetailMarkerElement & {
        sdkMarker: AMapMarker;
        onClick: (event: MouseEvent) => void;
        onPointerDown: (event: Event) => void;
        stopTooltipEvent: (event: Event) => void;
        onTooltipWheel: (event: WheelEvent) => void;
        onTooltipTouchStart: (event: TouchEvent) => void;
        onTooltipTouchMove: (event: TouchEvent) => void;
        onTooltipTouchEnd: (event: TouchEvent) => void;
      }
    > = [];
    let activeMarker: (typeof markerViews)[number] | undefined;
    const timeout = window.setTimeout(onDeadline, LOAD_TIMEOUT_MS);

    function routeColor(): string {
      return getComputedStyle(container).getPropertyValue('--hpm-route-color').trim() || '#0f766e';
    }

    function addSchematicRoute(): void {
      if (schematicRoute || model.map.route.length <= 1) return;
      schematicRoute = new api.Polyline({
        path: model.map.route.map((routePoint) => routePoint.coordinate),
        strokeColor: routeColor(),
        strokeWeight: 3,
      });
      map.add([schematicRoute]);
    }

    function removeTrackOverlays(): void {
      if (!trackOverlays.length) return;
      const overlays = [...trackOverlays];
      try {
        map.remove?.(overlays);
      } catch {
        // Every owned overlay is also detached below; map destruction remains the final boundary.
      }
      for (const overlay of overlays) {
        try {
          overlay.setMap?.(null);
        } catch {
          // A vendor cleanup failure must not turn track-only degradation into provider failure.
        }
      }
      trackOverlays.length = 0;
      fullTrackLines.length = 0;
      progressTrackLines.length = 0;
      movingTrackMarker = undefined;
      updateTrackProgress = undefined;
      trackMounted = false;
    }

    function reportTrackError(): void {
      if (trackErrorReported || destroyed) return;
      trackErrorReported = true;
      try {
        model.onTrackError?.();
      } catch {
        // The detail status callback is advisory and cannot make the provider unavailable.
      }
    }

    function degradeTrack(): void {
      if (destroyed) return;
      removeTrackOverlays();
      try {
        addSchematicRoute();
      } catch {
        fail();
        return;
      }
      trackReady = true;
      reportTrackError();
      finishIfReady();
    }

    function closeActive() {
      activeMarker?.setExpanded(false);
      activeMarker?.sdkMarker.setTop(false);
      activeMarker = undefined;
    }
    function onMapClick() {
      closeActive();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (!activeMarker) return;
      if (event.key === 'Escape') {
        const origin = activeMarker.button;
        closeActive();
        event.preventDefault();
        origin.focus();
        return;
      }
      const tooltip = activeMarker.scrollViewport;
      const maximum = Math.max(0, tooltip.scrollHeight - tooltip.clientHeight);
      if (maximum === 0) return;
      let next: number | undefined;
      if (event.key === 'ArrowDown') next = tooltip.scrollTop + 40;
      else if (event.key === 'ArrowUp') next = tooltip.scrollTop - 40;
      else if (event.key === 'PageDown') next = tooltip.scrollTop + tooltip.clientHeight;
      else if (event.key === 'PageUp') next = tooltip.scrollTop - tooltip.clientHeight;
      else if (event.key === 'End') next = maximum;
      else if (event.key === 'Home') next = 0;
      if (next === undefined) return;
      tooltip.scrollTop = Math.max(0, Math.min(maximum, next));
      event.preventDefault();
      event.stopPropagation();
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(timeout);
      trackAbort?.abort();
      map.off('complete', ready);
      map.off('error', fail);
      map.off('click', onMapClick);
      map.off('dragstart', closeActive);
      map.off('movestart', closeActive);
      map.off('zoomstart', closeActive);
      container.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', closeActive);
      window.removeEventListener('pagehide', closeActive);
      closeActive();
      markerViews.forEach((marker) => {
        marker.button.removeEventListener('click', marker.onClick);
        marker.button.removeEventListener('pointerdown', marker.onPointerDown);
        marker.tooltip.removeEventListener('click', marker.stopTooltipEvent);
        marker.tooltip.removeEventListener('pointerdown', marker.stopTooltipEvent);
        marker.scrollViewport.removeEventListener('wheel', marker.onTooltipWheel);
        marker.scrollViewport.removeEventListener('touchstart', marker.onTooltipTouchStart);
        marker.scrollViewport.removeEventListener('touchmove', marker.onTooltipTouchMove);
        marker.scrollViewport.removeEventListener('touchend', marker.onTooltipTouchEnd);
        marker.scrollViewport.removeEventListener('touchcancel', marker.onTooltipTouchEnd);
      });
      removeTrackOverlays();
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

    function onDeadline(): void {
      if (destroyed || complete) return;
      if (!mapReady) {
        fail();
        return;
      }
      if (!trackReady) {
        trackAbort?.abort();
        degradeTrack();
      }
    }

    function finishIfReady() {
      if (destroyed || complete || !mapReady || !trackReady) return;
      try {
        // AMap's avoid order is top, bottom, left, right. Reserve room for
        // the 44px bottom-anchored control plus a wrapped place tooltip.
        const fitOverlays = trackMounted ? [...markers, ...fullTrackLines] : markers;
        if (markers.length > 1 || fullTrackLines.length)
          map.setFitView(fitOverlays, true, [112, 24, 24, 24]);
        clearTimeout(timeout);
        complete = true;
        const handle: DetailMapHandle = {
          get hasTrack() {
            return trackMounted;
          },
          destroy,
          setInteractive(active) {
            if (destroyed) return;
            try {
              map.setStatus(interaction(active));
            } catch {
              fail();
            }
          },
          ...(updateTrackProgress
            ? {
                setTrackProgress(progress: number) {
                  if (destroyed || !trackMounted) return;
                  try {
                    updateTrackProgress?.(progress);
                  } catch {
                    degradeTrack();
                  }
                },
              }
            : {}),
        };
        resolve(handle);
      } catch {
        fail();
      }
    }

    function ready() {
      if (destroyed || complete) return;
      mapReady = true;
      finishIfReady();
    }
    map.on('complete', ready);
    map.on('error', fail);
    map.on('click', onMapClick);
    map.on('dragstart', closeActive);
    map.on('movestart', closeActive);
    map.on('zoomstart', closeActive);
    container.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', closeActive);
    window.addEventListener('pagehide', closeActive);
    model.signal?.addEventListener('abort', cancel, { once: true });
    if (model.signal?.aborted) {
      cancel();
      return;
    }

    try {
      const routeIds = new Set(model.map.route.map((point) => point.id));
      const visits = [
        ...model.map.route.map((point, index) => ({ point, sequence: index + 1 })),
        ...model.map.points
          .filter((point) => !routeIds.has(point.id))
          .map((point) => ({ point, sequence: undefined })),
      ];
      for (const { point, sequence } of visits) {
        const marker = createDetailMarker(point.name, sequence);
        const sdkMarker = new api.Marker({
          position: point.coordinate,
          content: marker.element,
          anchor: 'bottom-center',
        });
        const onClick = (event: MouseEvent) => {
          event.stopPropagation();
          if (activeMarker?.button === marker.button) closeActive();
          else {
            closeActive();
            activeMarker = markerView;
            sdkMarker.setTop(true);
            markerView.setExpanded(true);
            markerView.fitTooltip(container);
          }
        };
        const onPointerDown = (event: Event) => event.stopPropagation();
        const stopTooltipEvent = (event: Event) => event.stopPropagation();
        const onTooltipWheel = (event: WheelEvent) => {
          event.stopPropagation();
          event.preventDefault();
          marker.scrollViewport.scrollTop += event.deltaY;
        };
        let previousTouchY: number | undefined;
        const onTooltipTouchStart = (event: TouchEvent) => {
          previousTouchY = event.touches[0]?.clientY;
          event.stopPropagation();
        };
        const onTooltipTouchMove = (event: TouchEvent) => {
          const currentY = event.touches[0]?.clientY;
          if (previousTouchY !== undefined && currentY !== undefined) {
            marker.scrollViewport.scrollTop += previousTouchY - currentY;
            previousTouchY = currentY;
          }
          event.stopPropagation();
          event.preventDefault();
        };
        const onTooltipTouchEnd = (event: TouchEvent) => {
          previousTouchY = undefined;
          event.stopPropagation();
        };
        const markerView = {
          ...marker,
          sdkMarker,
          onClick,
          onPointerDown,
          stopTooltipEvent,
          onTooltipWheel,
          onTooltipTouchStart,
          onTooltipTouchMove,
          onTooltipTouchEnd,
        };
        marker.button.addEventListener('click', onClick);
        marker.button.addEventListener('pointerdown', onPointerDown);
        marker.tooltip.addEventListener('click', stopTooltipEvent);
        marker.tooltip.addEventListener('pointerdown', stopTooltipEvent);
        marker.scrollViewport.addEventListener('wheel', onTooltipWheel, { passive: false });
        marker.scrollViewport.addEventListener('touchstart', onTooltipTouchStart, {
          passive: true,
        });
        marker.scrollViewport.addEventListener('touchmove', onTooltipTouchMove, { passive: false });
        marker.scrollViewport.addEventListener('touchend', onTooltipTouchEnd, { passive: true });
        marker.scrollViewport.addEventListener('touchcancel', onTooltipTouchEnd, { passive: true });
        markerViews.push(markerView);
        markers.push(sdkMarker);
      }
      map.add(markers);
      if (destroyed) return;
      if (!model.track) {
        addSchematicRoute();
        return;
      }
      if (typeof api.convertFrom !== 'function') {
        degradeTrack();
        return;
      }
      void convertTrackFromGps(
        api as AMapApi & AMapTrackConversionApi,
        model.track,
        trackAbort!.signal,
        {
          timeoutMilliseconds: false,
        },
      ).then(
        (track) => {
          if (destroyed || trackReady) return;
          const styles = getComputedStyle(container);
          const fullColor =
            styles.getPropertyValue('--hpm-track-color').trim() ||
            styles.getPropertyValue('--hpm-route-color').trim() ||
            '#64748b';
          const progressColor =
            styles.getPropertyValue('--hpm-track-progress-color').trim() ||
            styles.getPropertyValue('--hpm-accent').trim() ||
            '#2563eb';
          try {
            for (const segment of track.segments) {
              const line = new api.Polyline({
                path: segment,
                strokeColor: fullColor,
                strokeOpacity: 0.55,
                strokeWeight: 5,
                lineCap: 'round',
                lineJoin: 'round',
              });
              fullTrackLines.push(line);
              trackOverlays.push(line);
            }
            if (model.trackPlayback === true) {
              const geometry = createTrackProgressGeometry(track);
              const initial = geometry.at(0);
              for (let index = 0; index < track.segments.length; index += 1) {
                const line = new api.Polyline({
                  // Keep a vendor-valid path while hiding all progress at the initial state.
                  path: track.segments[index]!,
                  strokeColor: progressColor,
                  strokeWeight: 5,
                  lineCap: 'round',
                  lineJoin: 'round',
                  zIndex: 41,
                });
                progressTrackLines.push(line);
                trackOverlays.push(line);
              }
              const markerContent = document.createElement('span');
              markerContent.className = 'hpm-track-marker';
              markerContent.setAttribute('aria-hidden', 'true');
              movingTrackMarker = new api.Marker({
                position: initial.coordinate,
                content: markerContent,
                anchor: 'center',
                clickable: false,
                bubble: false,
                keyboardEnable: false,
                zIndex: 42,
              });
              trackOverlays.push(movingTrackMarker);
              updateTrackProgress = (progress) => {
                const state = geometry.at(progress);
                for (let index = 0; index < progressTrackLines.length; index += 1) {
                  const line = progressTrackLines[index]!;
                  const path = state.paths[index]!;
                  if (path.length > 1) {
                    line.setPath(path);
                    line.show();
                  } else line.hide();
                }
                movingTrackMarker?.setPosition(state.coordinate);
              };
            }
            map.add(trackOverlays);
            if (destroyed) return;
            progressTrackLines.forEach((line) => line.hide());
            trackMounted = true;
            trackReady = true;
            finishIfReady();
          } catch {
            degradeTrack();
          }
        },
        () => {
          if (!destroyed && !trackReady) degradeTrack();
        },
      );
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

export async function createAMapProvider(config: BrowserProviderConfig): Promise<MapProvider> {
  const api = await loadAMapApi<AMapApi>(config);
  return {
    mountDetail: (container, model) => mountDetail(api, config.amap.mapStyle, container, model),
    mountOverview: (container, options) =>
      mountOverview(api, config.amap.mapStyle, container, options),
  };
}

export async function createAMapDetailProvider(
  config: BrowserProviderConfig,
): Promise<Pick<MapProvider, 'mountDetail'>> {
  const api = await loadAMapApi<AMapApi>(config);
  return {
    mountDetail: (container, model) => mountDetail(api, config.amap.mapStyle, container, model),
  };
}
