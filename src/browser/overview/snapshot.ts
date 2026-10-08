import { safeUrl } from '../../presentation/safe-html';
import type {
  OverviewPanelState,
  OverviewPostIndex,
  OverviewSnapshot,
  OverviewView,
  PanelScroll,
  SnapshotContext,
} from './exploration-types';
import { hasUrlUserinfo, isSafePostReference } from './post-index';

const MAX_SNAPSHOT_BYTES = 16_384;
const MAX_AGE = 7_200_000;
const encoder = new TextEncoder();

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fields(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
function reference(value: unknown, index?: OverviewPostIndex): value is string {
  return (
    isSafePostReference(value) &&
    (!index || (index.unique.has(value) && !index.ambiguous.has(value)))
  );
}
function scroll(
  value: unknown,
  index?: OverviewPostIndex,
  selection?: readonly string[],
): PanelScroll {
  if (!record(value)) return { top: 0 };
  const top = finite(value.top) ? clamp(value.top, 0, 1_000_000) : 0;
  const anchor = value.anchor;
  if (
    fields(value, ['top', 'anchor']) &&
    record(anchor) &&
    fields(anchor, ['url', 'offset']) &&
    reference(anchor.url, index) &&
    finite(anchor.offset) &&
    (!selection || selection.includes(anchor.url))
  ) {
    return {
      top,
      anchor: { url: anchor.url, offset: clamp(anchor.offset, -1_000_000, 1_000_000) },
    };
  }
  return { top };
}
function panel(value: unknown, index?: OverviewPostIndex): OverviewPanelState | undefined {
  if (!record(value)) return undefined;
  if (value.mode === 'closed') return fields(value, ['mode']) ? { mode: 'closed' } : undefined;
  if (value.mode === 'all') {
    return fields(value, ['mode', 'scroll'])
      ? { mode: 'all', scroll: scroll(value.scroll, index) }
      : undefined;
  }
  if (value.mode !== 'single' && value.mode !== 'group') return undefined;
  if (!fields(value, ['mode', 'urls', 'scroll'])) return undefined;
  const urls = value.urls;
  if (
    !Array.isArray(urls) ||
    urls.length === 0 ||
    urls.length > 128 ||
    (value.mode === 'single' && urls.length !== 1) ||
    !urls.every((url) => reference(url, index)) ||
    new Set(urls).size !== urls.length
  )
    return { mode: 'closed' };
  const refs = urls as string[];
  const position = scroll(value.scroll, index, refs);
  return value.mode === 'single'
    ? { mode: 'single', urls: [refs[0]!], scroll: position }
    : { mode: 'group', urls: [...refs], scroll: position };
}

/** Internal cache decoder: validates other scopes without applying this scope's dataset or zoom. */
export function readStoredSnapshot(raw: unknown, now?: number): OverviewSnapshot | undefined {
  return normalizeSnapshot(raw, now, Number.MAX_VALUE);
}
function normalizeSnapshot(
  raw: unknown,
  now: number | undefined,
  maxZoom: number,
  index?: OverviewPostIndex,
): OverviewSnapshot | undefined {
  try {
    if (typeof raw === 'string') {
      if (raw.length > 524_288 || encoder.encode(raw).length > 524_288) return undefined;
      raw = JSON.parse(raw) as unknown;
    }
    if (!finite(maxZoom) || maxZoom < 2 || (now !== undefined && (!finite(now) || now < 0)))
      return undefined;
    if (
      !record(raw) ||
      !fields(raw, ['version', 'savedAt', 'view', 'panel']) ||
      raw.version !== 1 ||
      !finite(raw.savedAt) ||
      raw.savedAt < 0
    )
      return undefined;
    if (now !== undefined && (now < raw.savedAt || now - raw.savedAt >= MAX_AGE)) return undefined;
    const view = raw.view;
    if (!record(view) || !fields(view, ['center', 'zoom']) || !finite(view.zoom)) return undefined;
    const center = view.center;
    if (
      !Array.isArray(center) ||
      center.length !== 2 ||
      !finite(center[0]) ||
      !finite(center[1]) ||
      Math.abs(center[0]) > 180 ||
      Math.abs(center[1]) > 90
    )
      return undefined;
    const state = panel(raw.panel, index);
    if (!state) return undefined;
    const snapshot: OverviewSnapshot = {
      version: 1,
      savedAt: raw.savedAt,
      view: { center: [center[0], center[1]], zoom: clamp(view.zoom, 2, maxZoom) },
      panel: state,
    };
    // Every field above is constructed explicitly; untrusted objects never enter serialization.
    if (encoder.encode(JSON.stringify(snapshot)).length <= MAX_SNAPSHOT_BYTES) return snapshot;
    return {
      version: 1,
      savedAt: snapshot.savedAt,
      view: snapshot.view,
      panel: { mode: 'closed' },
    };
  } catch {
    return undefined;
  }
}

export function readSnapshot(raw: unknown, context: SnapshotContext): OverviewSnapshot | undefined {
  return normalizeSnapshot(raw, context.now, context.maxZoom, context.index);
}
export function createSnapshot(
  view: OverviewView,
  panel: OverviewPanelState,
  context: SnapshotContext,
): OverviewSnapshot | undefined {
  return readSnapshot({ version: 1, savedAt: context.now, view, panel }, context);
}
export function encodeSnapshot(
  snapshot: OverviewSnapshot,
  context: SnapshotContext,
): string | undefined {
  const safe = readSnapshot(snapshot, context);
  return safe ? JSON.stringify(safe) : undefined;
}

export function createOverviewScope(
  origin: string,
  overviewUrl: string,
  dataUrl: string,
): string | undefined {
  try {
    if (
      safeUrl(origin, 'post') === null ||
      safeUrl(overviewUrl, 'post') === null ||
      safeUrl(dataUrl, 'post') === null
    )
      return undefined;
    if ([origin, overviewUrl, dataUrl].some(hasUrlUserinfo)) return undefined;
    const base = new URL(origin);
    const overview = new URL(overviewUrl, base.origin);
    const data = new URL(dataUrl, base.origin);
    if ([base, overview, data].some((url) => url.username !== '' || url.password !== ''))
      return undefined;
    return JSON.stringify([base.origin, overview.pathname, data.origin, data.pathname]);
  } catch {
    return undefined;
  }
}
