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
import { createOverviewShare, readOverviewShare } from './share';
import { createShareControls } from './share-controls';
import { chooseRandomPost, randomTargetZoom } from './random';

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
  changed(options?: { scroll?: boolean; top?: number }): void;
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
  let shareControls: ReturnType<typeof createShareControls> | undefined;
  let randomButton: HTMLButtonElement | undefined;
  let lastRandomUrl: string | undefined;
  let operation = 0;
  const cache = scope ? getDocumentSnapshotCache(owner) : undefined;
  const token = {};
  const owners = cache && ownership(cache);
  if (cache && scope) {
    owners!.delete(scope);
    owners!.set(scope, token);
    while (owners!.size > 16) owners!.delete(owners!.keys().next().value!);
  }
  const ownsScope = () => !!scope && owners?.get(scope) === token;
  const baseCurrent = () =>
    !disposed &&
    options.isCurrent() &&
    options.toolbar.parentElement === options.root &&
    options.toolbar.contains(options.showList);
  const controlsCurrent = () =>
    baseCurrent() &&
    (!randomButton || options.toolbar.querySelector('[data-hpm-random]') === randomButton);
  const current = () => controlsCurrent() && (!shareControls || shareControls.isCurrent());
  const shareContext = {
    origin: owner.location.origin,
    overviewUrl: options.overviewUrl,
    maxZoom: options.maxZoom,
    index,
  };
  const shared =
    current() && options.flags.share
      ? readOverviewShare(owner.location.href, shareContext)
      : undefined;
  const initial =
    !shared && scope && current() && options.flags.restore
      ? cache?.read(scope, context())
      : undefined;
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
  function scheduleCheckpoint(event?: { scroll?: boolean; top?: number }) {
    if (!current() || !handle || !options.flags.restore || !ownsScope()) return;
    if (!event?.scroll) capture();
    else if (
      candidate &&
      candidate.panel.mode !== 'closed' &&
      typeof event.top === 'number' &&
      Number.isFinite(event.top) &&
      event.top >= 0 &&
      event.top <= 1_000_000
    ) {
      // A delivered event knows the pixel position even if PJAX removes the
      // panel before the checkpoint. The old anchor is no longer measured at
      // this position; retain only pixels without geometry or encoding here.
      candidate = {
        ...candidate,
        savedAt: Date.now(),
        panel: { ...candidate.panel, scroll: { top: event.top } },
      };
    }
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      checkpoint();
    }, 200);
  }
  function changed(event?: { scroll?: boolean; top?: number }) {
    if (!event?.scroll) operation++;
    scheduleCheckpoint(event);
  }
  function randomClick() {
    if (!current() || !handle || !randomButton) return;
    const sequence = ++operation;
    try {
      const panel = options.panel.read();
      if (!current() || sequence !== operation) return;
      const excludedUrl =
        panel.mode === 'single' && index.unique.has(panel.urls[0]) ? panel.urls[0] : lastRandomUrl;
      const post = chooseRandomPost(index, excludedUrl, Math.random);
      if (!post || !current() || sequence !== operation) return;
      const view = handle.getView!();
      if (!view || !Number.isFinite(view.zoom) || !current() || sequence !== operation) return;
      const immediately = owner.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      if (!current() || sequence !== operation) return;
      lastRandomUrl = post.url;
      handle.focusPost!(post, randomTargetZoom(view.zoom, options.maxZoom), { immediately });
      if (!current() || sequence !== operation) return;
      options.panel.open(
        { mode: 'single', urls: [post.url], scroll: { top: 0 } },
        {
          focus: true,
          origin: randomButton,
          resolveOrigin: () => (current() ? randomButton : undefined),
        },
      );
      changed();
    } catch {
      /* SDK reads and focus are best effort; never reopen a previous preview. */
    }
  }
  function pagehide(event: PageTransitionEvent) {
    if (event.persisted) {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      checkpoint();
    }
  }
  return {
    initialView: shared?.view ?? initial?.view,
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
      if (shared) {
        options.panel.open(
          shared.postUrl
            ? { mode: 'single', urls: [shared.postUrl], scroll: { top: 0 } }
            : { mode: 'closed' },
          { focus: false },
        );
      } else if (initial) options.panel.open(initial.panel, { focus: false });
      if (options.flags.random && index.unique.size > 0) {
        randomButton = options.root.ownerDocument.createElement('button');
        randomButton.type = 'button';
        randomButton.className = 'hpm-overview__random';
        randomButton.dataset.hpmRandom = '';
        randomButton.textContent = '随机一站';
        randomButton.addEventListener('click', randomClick);
        options.toolbar.append(randomButton);
      }
      if (options.flags.share)
        shareControls = createShareControls({
          root: options.root,
          toolbar: options.toolbar,
          isCurrent: controlsCurrent,
          getLink: () => {
            const view = handle?.getView?.();
            return view ? createOverviewShare(view, options.panel.read(), shareContext) : undefined;
          },
        });
      unsubscribe = mounted.onViewEnd!(() => scheduleCheckpoint());
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
      operation++;
      randomButton?.removeEventListener('click', randomClick);
      randomButton?.remove();
      shareControls?.destroy();
      unsubscribe?.();
      owner.removeEventListener('pagehide', pagehide);
    },
  };
}
