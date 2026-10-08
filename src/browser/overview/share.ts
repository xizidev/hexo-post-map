import type { OverviewPanelState, OverviewPostIndex, OverviewView } from './exploration-types';
import { safeUrl } from '../../presentation/safe-html';
import { hasUrlUserinfo, isSafePostReference } from './post-index';
import { createSnapshot } from './snapshot';
export type OverviewShareState = { readonly view: OverviewView; readonly postUrl?: string };
export type ShareContext = {
  readonly origin: string;
  readonly overviewUrl: string;
  readonly maxZoom: number;
  readonly index: OverviewPostIndex;
};

const MAX_LINK_LENGTH = 4096;
const fields = ['hpm_v', 'hpm_center', 'hpm_zoom', 'hpm_post'];
const decimal = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/u;

function route(path: string): string {
  return path.endsWith('/index.html') ? path.slice(0, -10) : path;
}
function target(context: ShareContext): URL | undefined {
  if (
    [context.origin, context.overviewUrl].some(
      (value) => safeUrl(value, 'post') === null || hasUrlUserinfo(value),
    )
  )
    return undefined;
  const origin = new URL(context.origin);
  const url = new URL(context.overviewUrl, origin.origin);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    url.origin !== origin.origin ||
    url.search ||
    url.hash
  )
    return undefined;
  return url;
}
function postReference(value: unknown, context: ShareContext): value is string {
  return (
    isSafePostReference(value) &&
    context.index.unique.has(value) &&
    !context.index.ambiguous.has(value)
  );
}
function number(value: string | null): number | undefined {
  if (value === null || !decimal.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Untrusted query data is never used as a navigation or resource URL. */
export function readOverviewShare(
  locationHref: string,
  context: ShareContext,
): OverviewShareState | undefined {
  try {
    if (locationHref.length > MAX_LINK_LENGTH || hasUrlUserinfo(locationHref)) return undefined;
    const destination = target(context);
    if (!destination) return undefined;
    const url = new URL(locationHref);
    if (url.origin !== destination.origin || route(url.pathname) !== route(destination.pathname))
      return undefined;
    const seen = new Set<string>();
    for (const key of url.searchParams.keys()) {
      if (!key.startsWith('hpm_')) continue;
      if (!fields.includes(key) || seen.has(key)) return undefined;
      seen.add(key);
    }
    if (url.searchParams.get('hpm_v') !== '1') return undefined;
    const center = url.searchParams.get('hpm_center')?.split(',');
    if (!center || center.length !== 2) return undefined;
    const longitude = number(center[0]!);
    const latitude = number(center[1]!);
    const zoom = number(url.searchParams.get('hpm_zoom'));
    if (longitude === undefined || latitude === undefined || zoom === undefined) return undefined;
    const safe = createSnapshot(
      { center: [longitude, latitude], zoom },
      { mode: 'closed' },
      { now: 0, maxZoom: context.maxZoom, index: context.index },
    );
    if (!safe) return undefined;
    // URLSearchParams decodes exactly once; keep encoded separators inside dataset references.
    const ref = url.searchParams.get('hpm_post');
    return postReference(ref, context) ? { view: safe.view, postUrl: ref } : { view: safe.view };
  } catch {
    return undefined;
  }
}

export function createOverviewShare(
  view: OverviewView,
  panel: OverviewPanelState,
  context: ShareContext,
): string | undefined {
  try {
    const url = target(context);
    const safe = createSnapshot(
      view,
      { mode: 'closed' },
      { now: 0, maxZoom: context.maxZoom, index: context.index },
    );
    if (!url || !safe) return undefined;
    url.searchParams.set('hpm_v', '1');
    url.searchParams.set(
      'hpm_center',
      safe.view.center.map((value) => String(Number(value.toFixed(6)))).join(','),
    );
    url.searchParams.set('hpm_zoom', String(Number(safe.view.zoom.toFixed(2))));
    if (url.href.length > MAX_LINK_LENGTH) return undefined;
    if (
      panel.mode === 'single' &&
      panel.urls.length === 1 &&
      postReference(panel.urls[0], context)
    ) {
      url.searchParams.set('hpm_post', panel.urls[0]);
      if (url.href.length > MAX_LINK_LENGTH) url.searchParams.delete('hpm_post');
    }
    return url.href;
  } catch {
    return undefined;
  }
}
