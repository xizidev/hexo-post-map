import type { AuthorDraft } from '../../author/types';
import type { Coordinate } from '../../domain/types';
import { loadAMapApi, type AMapSdkApi, type AMapSdkMap } from '../providers/amap-sdk';
import type { BrowserProviderConfig } from '../providers/types';
import { createAuthorMarker } from './marker';

export interface AuthorMapOptions {
  config: BrowserProviderConfig;
  defaultZoom: number;
  signal: AbortSignal;
  onCandidate(coordinate: Coordinate): void;
  onSelect(id: string): void;
  onMove(id: string, coordinate: Coordinate): void;
  onWarning(message: string): void;
}

export interface AuthorMapHandle {
  render(draft: AuthorDraft, selectedId?: string, options?: { fitView?: boolean }): void;
  setCandidate(coordinate: Coordinate | undefined): void;
  destroy(): void;
}

type AuthorListener = (event?: unknown) => void;
interface AuthorMarker {
  on(event: string, listener: AuthorListener): void;
  off(event: string, listener: AuthorListener): void;
  setPosition(coordinate: Coordinate): void;
  setContent(content: HTMLElement): void;
  setDraggable(enabled: boolean): void;
}
interface AuthorPolyline {
  setPath(path: readonly Coordinate[]): void;
}
interface AuthorSdkMap extends AMapSdkMap {
  on(event: string, listener: AuthorListener): void;
  off(event: string, listener: AuthorListener): void;
  remove(overlays: unknown[]): void;
  setZoomAndCenter(zoom: number, center: Coordinate, immediately: boolean): void;
}
interface AuthorApi extends AMapSdkApi {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AuthorSdkMap;
  Marker: new (options: Record<string, unknown>) => AuthorMarker;
  Polyline: new (options: Record<string, unknown>) => AuthorPolyline;
}
interface MarkerEntry {
  readonly marker: AuthorMarker;
  readonly content: HTMLElement;
  coordinate: Coordinate;
  label: string;
  selected: boolean;
  detach(): void;
}

const SDK_WARNING = '地图预览暂不可用，请继续手动编辑并导出草稿。';
const PREVIEW_WARNING = '部分坐标或缩放超出地图预览范围，原始数据仍保留并可导出。';
const MAX_PREVIEW_LATITUDE = 85.0511287798066;

function validCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}

function eventCoordinate(event: unknown): Coordinate | undefined {
  try {
    if (event === null || typeof event !== 'object') return;
    const position: unknown = Reflect.get(event, 'lnglat');
    if (position === null || typeof position !== 'object') return;
    const getLng: unknown = Reflect.get(position, 'getLng');
    const getLat: unknown = Reflect.get(position, 'getLat');
    if (typeof getLng !== 'function' || typeof getLat !== 'function') return;
    const coordinate: unknown = [
      Reflect.apply(getLng, position, []),
      Reflect.apply(getLat, position, []),
    ];
    return validCoordinate(coordinate) ? coordinate : undefined;
  } catch {
    return;
  }
}

function stopPropagation(event: unknown): boolean {
  try {
    if (event === null || typeof event !== 'object') return true;
    const origin: unknown = Reflect.get(event, 'originEvent');
    if (origin !== null && typeof origin === 'object') {
      const stop: unknown = Reflect.get(origin, 'stopPropagation');
      if (typeof stop === 'function') Reflect.apply(stop, origin, []);
    }
    return true;
  } catch {
    return false;
  }
}

function sameCoordinate(left: Coordinate, right: Coordinate): boolean {
  return Object.is(left[0], right[0]) && Object.is(left[1], right[1]);
}

const inactiveHandle: AuthorMapHandle = {
  render() {},
  setCandidate() {},
  destroy() {},
};

/** Own only this map and its overlays. SDK loading retains the shared reader boundary. */
export async function createAuthorMap(
  container: HTMLElement,
  options: AuthorMapOptions,
): Promise<AuthorMapHandle> {
  if (options.signal.aborted) return inactiveHandle;
  let api: AuthorApi;
  let map: AuthorSdkMap;
  try {
    api = await loadAMapApi<AuthorApi>(options.config);
    if (options.signal.aborted) return inactiveHandle;
    map = new api.Map(container, {
      center: [104, 35],
      zoom: 4,
      mapStyle: options.config.amap.mapStyle,
      rotateEnable: false,
    });
  } catch {
    if (!options.signal.aborted) options.onWarning(SDK_WARNING);
    return inactiveHandle;
  }

  let destroyed = false;
  const entries = new Map<string, MarkerEntry>();
  let line: AuthorPolyline | undefined;
  let path: readonly Coordinate[] = [];
  let candidate: AuthorMarker | undefined;
  let candidateCoordinate: Coordinate | undefined;
  const owned = new Set<unknown>();
  const active = () => !destroyed && !options.signal.aborted;
  function cleanup(action: () => void): void {
    try {
      action();
    } catch {
      options.onWarning(SDK_WARNING);
    }
  }
  function add(overlay: unknown): void {
    owned.add(overlay);
    try {
      map.add([overlay]);
    } catch (error) {
      cleanup(() => remove(overlay));
      throw error;
    }
  }
  function remove(overlay: unknown): void {
    if (owned.has(overlay)) {
      map.remove([overlay]);
      owned.delete(overlay);
    }
  }
  function previewable(coordinate: Coordinate): boolean {
    if (!validCoordinate(coordinate) || Math.abs(coordinate[1]) > MAX_PREVIEW_LATITUDE) {
      options.onWarning(PREVIEW_WARNING);
      return false;
    }
    return true;
  }
  function bind(id: string, entry: MarkerEntry): void {
    const content = entry.content;
    const current = () => active() && entries.get(id) === entry;
    const click: AuthorListener = (event) => {
      if (stopPropagation(event) && current()) options.onSelect(id);
    };
    const drag: AuthorListener = (event) => {
      if (!current() || !entry.selected) return;
      const coordinate = eventCoordinate(event);
      if (coordinate) options.onMove(id, coordinate);
    };
    const domClick = (event: MouseEvent) => {
      event.stopPropagation();
      if (current()) options.onSelect(id);
    };
    entry.detach = () => {
      content.removeEventListener('click', domClick);
      cleanup(() => entry.marker.off('click', click));
      cleanup(() => entry.marker.off('dragend', drag));
    };
    content.addEventListener('click', domClick);
    entry.marker.on('click', click);
    entry.marker.on('dragend', drag);
  }
  const onClick: AuthorListener = (event) => {
    if (!active()) return;
    try {
      if (event !== null && typeof event === 'object') {
        const origin: unknown = Reflect.get(event, 'originEvent');
        if (origin !== null && typeof origin === 'object' && Reflect.get(origin, 'cancelBubble'))
          return;
      }
    } catch {
      return;
    }
    const coordinate = eventCoordinate(event);
    if (coordinate) options.onCandidate(coordinate);
  };
  try {
    map.on('click', onClick);
  } catch {
    options.onWarning(SDK_WARNING);
    cleanup(() => map.off('click', onClick));
    cleanup(() => map.destroy());
    return inactiveHandle;
  }

  const handle: AuthorMapHandle = {
    render(draft, selectedId, renderOptions) {
      if (!active()) return;
      try {
        if (draft.zoom !== undefined && (draft.zoom < 2 || draft.zoom > 20))
          options.onWarning(PREVIEW_WARNING);
        const points = new Map(draft.points.map((point) => [point.id, point]));
        const removed: MarkerEntry[] = [];
        for (const [id, entry] of entries) {
          if (!points.has(id)) {
            entries.delete(id);
            removed.push(entry);
          }
        }
        // Invalidate all removed IDs before any SDK cleanup can interrupt the render.
        for (const entry of removed) {
          entry.detach();
          cleanup(() => remove(entry.marker));
        }
        for (const point of draft.points) {
          const coordinate: Coordinate = [point.longitude, point.latitude];
          const previous = entries.get(point.id);
          if (!previewable(coordinate)) {
            if (previous) {
              entries.delete(point.id);
              previous.detach();
              cleanup(() => remove(previous.marker));
            }
            continue;
          }
          const selected = point.id === selectedId;
          if (
            previous &&
            sameCoordinate(previous.coordinate, coordinate) &&
            previous.label === point.name &&
            previous.selected === selected
          )
            continue;

          // SDK synchronization is transactional: an incomplete entry is never current.
          entries.delete(point.id);
          previous?.detach();
          let next: MarkerEntry | undefined;
          try {
            if (previous) {
              const contentChanged =
                previous.label !== point.name || previous.selected !== selected;
              const content = contentChanged
                ? createAuthorMarker(point.name, selected)
                : previous.content;
              next = {
                marker: previous.marker,
                content,
                coordinate,
                label: point.name,
                selected,
                detach() {},
              };
              if (!sameCoordinate(previous.coordinate, coordinate))
                next.marker.setPosition(coordinate);
              if (previous.selected !== selected) next.marker.setDraggable(selected);
              if (contentChanged) next.marker.setContent(content);
            } else {
              const content = createAuthorMarker(point.name, selected);
              const marker = new api.Marker({
                position: coordinate,
                content,
                draggable: selected,
                bubble: false,
                anchor: 'bottom-center',
              });
              next = { marker, content, coordinate, label: point.name, selected, detach() {} };
            }
            bind(point.id, next);
            if (!previous) add(next.marker);
            entries.set(point.id, next);
          } catch {
            next?.detach();
            const failedMarker = next?.marker ?? previous?.marker;
            if (failedMarker) cleanup(() => remove(failedMarker));
            options.onWarning(SDK_WARNING);
          }
        }
        // An unpreviewable stop must not silently join the two surrounding stops.
        const nextPath = draft.route.every((id) => entries.has(id))
          ? draft.route.map((id) => entries.get(id)!.coordinate)
          : [];
        if (nextPath.length < 2) {
          if (line) remove(line);
          line = undefined;
          path = [];
        } else if (
          nextPath.length !== path.length ||
          nextPath.some((coordinate, index) => !sameCoordinate(coordinate, path[index]!))
        ) {
          if (line) line.setPath(nextPath);
          else {
            const nextLine = new api.Polyline({
              path: nextPath,
              strokeColor: '#2563eb',
              strokeWeight: 4,
              bubble: false,
            });
            add(nextLine);
            line = nextLine;
          }
          path = nextPath;
        }
        if (renderOptions?.fitView) {
          const visible = [...entries.values()];
          if (visible.length === 1) {
            const zoom = draft.zoom ?? options.defaultZoom;
            map.setZoomAndCenter(
              Math.min(20, Math.max(2, Number.isFinite(zoom) ? zoom : 4)),
              visible[0]!.coordinate,
              true,
            );
          } else if (visible.length > 1)
            map.setFitView(
              visible.map((entry) => entry.marker),
              true,
              [32, 32, 32, 32],
            );
        }
      } catch {
        options.onWarning(SDK_WARNING);
      }
    },
    setCandidate(coordinate) {
      if (!active()) return;
      try {
        if (coordinate === undefined || !previewable(coordinate)) {
          if (candidate) remove(candidate);
          candidate = undefined;
          candidateCoordinate = undefined;
        } else if (!candidate) {
          const content = createAuthorMarker('待添加地点', false);
          content.setAttribute('disabled', '');
          const nextCandidate = new api.Marker({
            position: coordinate,
            content,
            draggable: false,
            bubble: false,
            anchor: 'bottom-center',
          });
          add(nextCandidate);
          candidate = nextCandidate;
          candidateCoordinate = coordinate;
        } else if (!candidateCoordinate || !sameCoordinate(candidateCoordinate, coordinate)) {
          candidate.setPosition(coordinate);
          candidateCoordinate = coordinate;
        }
      } catch {
        options.onWarning(SDK_WARNING);
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      options.signal.removeEventListener('abort', handle.destroy);
      cleanup(() => map.off('click', onClick));
      entries.forEach((entry) => entry.detach());
      entries.clear();
      if (owned.size > 0) cleanup(() => map.remove([...owned]));
      owned.clear();
      candidate = undefined;
      line = undefined;
      cleanup(() => map.destroy());
    },
  };
  options.signal.addEventListener('abort', handle.destroy, { once: true });
  if (options.signal.aborted) handle.destroy();
  return handle;
}
