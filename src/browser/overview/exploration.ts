import type { OverviewPost } from '../../templates/overview';
import type { FocusOriginResolver, OverviewMapHandle } from '../providers/types';
import type {
  ExplorationFlags,
  OverviewPanelState,
  OverviewSnapshot,
  OverviewView,
} from './exploration-types';
import { createPostIndex, hasUrlUserinfo } from './post-index';
import { createOverviewScope, createSnapshot } from './snapshot';
import { getDocumentSnapshotCache, type SnapshotCache } from './snapshot-cache';

const scopeOwners = new WeakMap<SnapshotCache, Map<string, object>>();
const ownershipKey = Symbol.for('hexo-post-map.overview-scope-owners.v1');
type OwnershipCache = SnapshotCache & { [ownershipKey]?: Map<string, object> };

function ownership(cache: SnapshotCache): Map<string, object> {
  const target = cache as OwnershipCache;
  if (target[ownershipKey]) return target[ownershipKey];
  let owners = scopeOwners.get(cache);
  if (!owners) {
    owners = new Map();
    scopeOwners.set(cache, owners);
    try {
      Object.defineProperty(target, ownershipKey, { value: owners });
    } catch {
      /* Restricted caches can still use this bundle's bounded fallback. */
    }
  }
  return owners;
}

export function readBrowserExplorationConfig(
  raw: unknown,
  origin: string,
): { readonly overviewUrl: string; readonly flags: ExplorationFlags } | undefined {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const config = raw as Record<string, unknown>;
    const flags = config.exploration;
    if (
      typeof config.overviewUrl !== 'string' ||
      !flags ||
      typeof flags !== 'object' ||
      Array.isArray(flags)
    )
      return undefined;
    const values = flags as Record<string, unknown>;
    if (
      Object.keys(values).some((key) => !['restore', 'share', 'random'].includes(key)) ||
      !['restore', 'share', 'random'].every((key) => typeof values[key] === 'boolean')
    )
      return undefined;
    if (
      hasUrlUserinfo(config.overviewUrl) ||
      !createOverviewScope(origin, config.overviewUrl, config.overviewUrl)
    )
      return undefined;
    const url = new URL(config.overviewUrl, origin);
    if (url.origin !== new URL(origin).origin || url.search || url.hash) return undefined;
    return {
      overviewUrl: config.overviewUrl,
      flags: {
        restore: values.restore as boolean,
        share: values.share as boolean,
        random: values.random as boolean,
      },
    };
  } catch {
    return undefined;
  }
}

export interface OverviewPanelPort {
  read(): OverviewPanelState;
  open(
    state: OverviewPanelState,
    options: { focus: boolean; origin?: HTMLElement; resolveOrigin?: FocusOriginResolver },
  ): void;
}
export interface ExplorationOptions {
  readonly root: HTMLElement;
  readonly canvas: HTMLElement;
  readonly toolbar: HTMLElement;
  readonly showList: HTMLButtonElement;
  readonly overviewUrl: string;
  readonly dataUrl: string;
  readonly flags: ExplorationFlags;
  readonly maxZoom: number;
  readonly posts: readonly OverviewPost[];
  readonly panel: OverviewPanelPort;
  readonly isCurrent: () => boolean;
}
export interface ExplorationController {
  readonly initialView?: OverviewView;
  activate(handle: OverviewMapHandle): void;
  changed(options?: { scroll?: boolean }): void;
  isCurrent(): boolean;
  destroy(options: { save: boolean }): void;
}

/** Overview owns this listener: BFCache keeps the live SDK and only checkpoints it. */
export function createExplorationController(options: ExplorationOptions): ExplorationController {
  const owner = options.root.ownerDocument.defaultView!;
  const scope = createOverviewScope(owner.location.origin, options.overviewUrl, options.dataUrl);
  const index = createPostIndex(options.posts);
  const context = () => ({ now: Date.now(), maxZoom: options.maxZoom, index });
  let disposed = false;
  let handle: OverviewMapHandle | undefined;
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let candidate: OverviewSnapshot | undefined;
  const cache = scope ? getDocumentSnapshotCache(owner) : undefined;
  const token = {};
  const owners = cache && ownership(cache);
  if (cache && scope) {
    owners!.delete(scope);
    owners!.set(scope, token);
    while (owners!.size > 16) owners!.delete(owners!.keys().next().value!);
  }
  const ownsScope = () => !!scope && owners?.get(scope) === token;
  const current = () => !disposed && options.isCurrent();
  const initial =
    scope && current() && options.flags.restore ? cache?.read(scope, context()) : undefined;
  if (scope && current() && !options.flags.restore) cache?.remove(scope);
  function capture() {
    if (!current() || !handle || !options.flags.restore || !ownsScope()) return;
    try {
      const view = handle.getView?.();
      if (view) candidate = createSnapshot(view, options.panel.read(), context()) ?? candidate;
    } catch {
      /* SDK reads are best effort; retain the last validated candidate. */
    }
  }
  function saveCandidate() {
    if (handle && options.flags.restore && scope && ownsScope() && candidate)
      cache?.save(scope, candidate, context());
  }
  function checkpoint() {
    if (!current() || !ownsScope()) return;
    capture();
    saveCandidate();
  }
  function changed(event?: { scroll?: boolean }) {
    if (!current() || !handle || !options.flags.restore || !ownsScope()) return;
    if (!event?.scroll) capture();
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      checkpoint();
    }, 200);
  }
  function pagehide(event: PageTransitionEvent) {
    if (event.persisted) {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      checkpoint();
    }
  }
  return {
    initialView: initial?.view,
    isCurrent: current,
    activate(mounted) {
      if (
        !current() ||
        handle ||
        !['getView', 'setView', 'focusPost', 'onViewEnd'].every(
          (key) => typeof Reflect.get(mounted, key) === 'function',
        )
      )
        return;
      handle = mounted;
      if (initial) options.panel.open(initial.panel, { focus: false });
      unsubscribe = mounted.onViewEnd!(() => changed());
      owner.addEventListener('pagehide', pagehide);
    },
    changed,
    destroy({ save }) {
      if (disposed) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (save) {
        capture();
        saveCandidate();
      }
      disposed = true;
      unsubscribe?.();
      owner.removeEventListener('pagehide', pagehide);
    },
  };
}
