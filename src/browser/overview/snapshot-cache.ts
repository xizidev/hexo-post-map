import type { OverviewSnapshot, SnapshotContext } from './exploration-types';
import { readSnapshot, readStoredSnapshot } from './snapshot';

const STORAGE_KEY = 'hexo-post-map.overview-state.v1';
const DOCUMENT_KEY = Symbol.for('hexo-post-map.overview-cache.v1');
const MAX_SCOPES = 16;
const MAX_ENVELOPE_BYTES = 524_288;
type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Entry = { readonly scope: string; readonly snapshot: OverviewSnapshot };

export interface SnapshotCache {
  read(scope: string, context: SnapshotContext): OverviewSnapshot | undefined;
  save(scope: string, snapshot: OverviewSnapshot, context: SnapshotContext): void;
  remove(scope: string): void;
}

function trimScopes(scopes: Map<string, OverviewSnapshot>, now?: number): void {
  const retained = new Set(
    Array.from(scopes, ([scope, snapshot]) => ({ scope, snapshot }))
      .reverse()
      .filter((entry) => readStoredSnapshot(entry.snapshot, now) !== undefined)
      .sort((a, b) => b.snapshot.savedAt - a.snapshot.savedAt)
      .slice(0, MAX_SCOPES)
      .map(({ scope }) => scope),
  );
  // Keep insertion order for ties, including across persistence and later saves.
  for (const scope of scopes.keys()) if (!retained.has(scope)) scopes.delete(scope);
}

function entries(raw: string | null, now?: number): Entry[] {
  if (
    raw === null ||
    raw.length > MAX_ENVELOPE_BYTES ||
    new TextEncoder().encode(raw).length > MAX_ENVELOPE_BYTES
  )
    return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const envelope = value as Record<string, unknown>;
    if (
      envelope.version !== 1 ||
      !Array.isArray(envelope.scopes) ||
      Object.keys(envelope).some((key) => key !== 'version' && key !== 'scopes')
    )
      return [];
    const scopes = new Map<string, OverviewSnapshot>();
    for (const raw of envelope.scopes) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const entry = raw as Record<string, unknown>;
      if (
        typeof entry.scope !== 'string' ||
        Object.keys(entry).some((key) => key !== 'scope' && key !== 'snapshot')
      )
        continue;
      const snapshot = readStoredSnapshot(entry.snapshot, now);
      if (
        snapshot &&
        (!scopes.has(entry.scope) || scopes.get(entry.scope)!.savedAt <= snapshot.savedAt)
      ) {
        scopes.delete(entry.scope);
        scopes.set(entry.scope, snapshot);
        trimScopes(scopes, now);
      }
    }
    return Array.from(scopes, ([scope, snapshot]) => ({ scope, snapshot }));
  } catch {
    return [];
  }
}

export function createSnapshotCache(options: {
  storage: () => SessionStorage | undefined;
}): SnapshotCache {
  const memory = new Map<string, OverviewSnapshot>();
  let loaded = false;
  let hydrated = false;
  function trim(now?: number): void {
    trimScopes(memory, now);
  }
  function load(now?: number): void {
    if (loaded) return;
    // Load at most once: failed removals must not resurrect stale persistent state in this document.
    loaded = true;
    try {
      const storage = options.storage();
      if (!storage) return;
      const stored = storage.getItem(STORAGE_KEY);
      for (const { scope, snapshot } of entries(stored, now)) memory.set(scope, snapshot);
      hydrated = true;
    } catch {
      /* Storage can be blocked; this document's memory remains usable. */
    }
    trim(now);
  }
  function persist(): void {
    // An unread envelope may contain other scopes: failed hydration stays memory-only.
    if (!hydrated) return;
    try {
      const storage = options.storage();
      if (!storage) return;
      if (memory.size === 0) {
        storage.removeItem(STORAGE_KEY);
        return;
      }
      const scopes = Array.from(memory, ([scope, snapshot]) => ({ scope, snapshot }));
      const encoded = JSON.stringify({ version: 1, scopes });
      if (new TextEncoder().encode(encoded).length <= MAX_ENVELOPE_BYTES)
        storage.setItem(STORAGE_KEY, encoded);
    } catch {
      /* Accept memory first; persistence is best effort. */
    }
  }
  return {
    read(scope, context) {
      load(context.now);
      trim(context.now);
      return readSnapshot(memory.get(scope), context);
    },
    save(scope, snapshot, context) {
      const safe = readSnapshot(snapshot, context);
      if (!safe) return;
      load(context.now);
      memory.delete(scope);
      memory.set(scope, safe);
      trim(context.now);
      persist();
    },
    remove(scope) {
      load();
      memory.delete(scope);
      persist();
    },
  };
}

type CacheOwner = Window & { [DOCUMENT_KEY]?: SnapshotCache };
const fallbackCaches = new WeakMap<Window, SnapshotCache>();
export function getDocumentSnapshotCache(owner: Window): SnapshotCache {
  const target = owner as CacheOwner;
  try {
    if (target[DOCUMENT_KEY]) return target[DOCUMENT_KEY];
  } catch {
    /* A restricted owner may disallow property access. */
  }
  const fallback = fallbackCaches.get(owner);
  if (fallback) return fallback;
  const cache = createSnapshotCache({ storage: () => owner.sessionStorage });
  try {
    Object.defineProperty(target, DOCUMENT_KEY, { value: cache });
  } catch {
    fallbackCaches.set(owner, cache);
  }
  return cache;
}
