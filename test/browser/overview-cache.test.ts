import { describe, expect, it } from 'vitest';
import type { OverviewPost } from '../../src/templates/overview';
import { createPostIndex } from '../../src/browser/overview/post-index';
import {
  createSnapshotCache,
  getDocumentSnapshotCache,
} from '../../src/browser/overview/snapshot-cache';

const key = 'hexo-post-map.overview-state.v1';
const a: OverviewPost = {
  title: 'A',
  url: '/blog/a/',
  image: '/a.jpg',
  date: '2026-01-01',
  location: { name: '上海', longitude: 121.49, latitude: 31.24 },
};
const b: OverviewPost = { ...a, title: 'B', url: '/blog/b/' };
const now = 10_000_000;
const view = { center: [121.49, 31.24] as const, zoom: 11 };
const context = { now, maxZoom: 18, index: createPostIndex([a, b]) };
function storageFixture() {
  const values = new Map<string, string>([['theme-session', 'keep']]);
  const calls: string[] = [];
  let failure: 'getItem' | 'setItem' | 'removeItem' | undefined;
  const storage = {
    getItem(key: string) {
      calls.push(`get:${key}`);
      if (failure === 'getItem') throw Error('denied');
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      calls.push(`set:${key}`);
      if (failure === 'setItem') throw Error('quota');
      values.set(key, value);
    },
    removeItem(key: string) {
      calls.push(`remove:${key}`);
      if (failure === 'removeItem') throw Error('denied');
      values.delete(key);
    },
    clear() {
      throw Error('must not clear other sessions');
    },
  };
  return {
    storage,
    values,
    calls,
    fail(next: typeof failure) {
      failure = next;
    },
  };
}
const snapshot = (ctx = context) => ({
  version: 1 as const,
  savedAt: ctx.now,
  view,
  panel: { mode: 'single' as const, urls: [a.url] as const, scroll: { top: 4 } },
});

describe('overview session cache', () => {
  it('restores only allowed state in the requested scope', () => {
    const fixture = storageFixture();
    const cache = createSnapshotCache({ storage: () => fixture.storage });
    cache.save('scope-a', snapshot(), context);
    expect(cache.read('scope-b', context)).toBeUndefined();
    expect(
      createSnapshotCache({ storage: () => fixture.storage }).read('scope-a', context),
    ).toEqual(snapshot());
    expect(JSON.parse(fixture.values.get(key)!)).toEqual({
      version: 1,
      scopes: [{ scope: 'scope-a', snapshot: snapshot() }],
    });
  });

  it('retains the 16 most recently saved scopes', () => {
    const fixture = storageFixture();
    const cache = createSnapshotCache({ storage: () => fixture.storage });
    for (let i = 0; i < 16; i++) {
      const ctx = { ...context, now: now + i };
      cache.save(`scope-${i}`, snapshot(ctx), ctx);
    }
    const ctx = { ...context, now: now + 30 };
    cache.save('scope-0', snapshot(ctx), ctx);
    cache.read('scope-1', ctx); // Reading must not make this scope recently saved.
    cache.save('scope-16', snapshot(ctx), ctx);
    expect(cache.read('scope-0', ctx)).toBeDefined();
    expect(cache.read('scope-1', ctx)).toBeUndefined();
    expect(cache.read('scope-2', ctx)).toBeDefined();
    const fresh = createSnapshotCache({ storage: () => fixture.storage });
    expect(fresh.read('scope-1', ctx)).toBeUndefined();
    expect(fresh.read('scope-16', ctx)).toBeDefined();
    expect(JSON.parse(fixture.values.get(key)!).scopes).toHaveLength(16);
    const memory = createSnapshotCache({ storage: () => undefined });
    for (let i = 16; i >= 0; i--) {
      const saved = { ...context, now: now + i };
      memory.save(`scope-${i}`, snapshot(saved), ctx);
    }
    expect(memory.read('scope-0', ctx)).toBeUndefined();
    expect(memory.read('scope-16', ctx)).toBeDefined();
  });

  it('recovers from every storage exception using memory', () => {
    for (const operation of ['getItem', 'setItem', 'removeItem', 'getter'] as const) {
      const fixture = storageFixture();
      let getterFails = false;
      const cache = createSnapshotCache({
        storage: () => {
          if (getterFails) throw Error('security');
          return fixture.storage;
        },
      });
      if (operation === 'getter') getterFails = true;
      else fixture.fail(operation);
      expect(() => cache.save('scope', snapshot(), context)).not.toThrow();
      expect(cache.read('scope', context)).toEqual(snapshot());
      expect(() => cache.remove('scope')).not.toThrow();
      expect(cache.read('scope', context)).toBeUndefined();
      getterFails = false;
      fixture.fail(undefined);
      expect(cache.read('scope', context)).toBeUndefined();
    }
  });

  it.each(['getter', 'getItem'] as const)(
    'preserves unknown stored scopes after initial %s failure and later removal',
    (operation) => {
      const fixture = storageFixture();
      const initial = JSON.stringify({
        version: 1,
        scopes: [
          { scope: 'a', snapshot: snapshot() },
          {
            scope: 'b',
            snapshot: {
              ...snapshot(),
              panel: { mode: 'single', urls: [b.url], scroll: { top: 8 } },
            },
          },
        ],
      });
      fixture.values.set(key, initial);
      let getterFails = operation === 'getter';
      if (operation === 'getItem') fixture.fail('getItem');
      const cache = createSnapshotCache({
        storage: () => {
          if (getterFails) throw Error('temporarily blocked');
          return fixture.storage;
        },
      });
      expect(cache.read('a', context)).toBeUndefined();
      getterFails = false;
      fixture.fail(undefined);
      cache.remove('a');
      expect(cache.read('a', context)).toBeUndefined();
      const fresh = createSnapshotCache({ storage: () => fixture.storage });
      expect(fresh.read('b', context)?.panel).toEqual({
        mode: 'single',
        urls: [b.url],
        scroll: { top: 8 },
      });
      // Failed hydration means this instance is memory-only; even its target stays persisted.
      expect(fixture.values.get(key)).toBe(initial);
      expect(fixture.values.get('theme-session')).toBe('keep');
    },
  );

  it.each(['getter', 'getItem'] as const)(
    'preserves unknown stored scopes after initial %s failure and later save',
    (operation) => {
      const fixture = storageFixture();
      const initial = JSON.stringify({
        version: 1,
        scopes: [
          { scope: 'a', snapshot: snapshot() },
          {
            scope: 'b',
            snapshot: {
              ...snapshot(),
              panel: { mode: 'single', urls: [b.url], scroll: { top: 8 } },
            },
          },
        ],
      });
      fixture.values.set(key, initial);
      let getterFails = operation === 'getter';
      if (operation === 'getItem') fixture.fail('getItem');
      const cache = createSnapshotCache({
        storage: () => {
          if (getterFails) throw Error('temporarily blocked');
          return fixture.storage;
        },
      });
      expect(cache.read('a', context)).toBeUndefined();
      getterFails = false;
      fixture.fail(undefined);
      const newer = { ...snapshot(), view: { ...view, zoom: 12 } };
      cache.save('a', newer, context);
      expect(cache.read('a', context)).toEqual(newer);
      const fresh = createSnapshotCache({ storage: () => fixture.storage });
      expect(fresh.read('b', context)?.panel).toEqual({
        mode: 'single',
        urls: [b.url],
        scroll: { top: 8 },
      });
      expect(fixture.values.get(key)).toBe(initial);
      cache.remove('a');
      expect(cache.read('a', context)).toBeUndefined();
      expect(fixture.values.get(key)).toBe(initial);
    },
  );

  it('keeps the latest saves when timestamps tie', () => {
    const fixture = storageFixture();
    const cache = createSnapshotCache({ storage: () => fixture.storage });
    for (let i = 0; i < 17; i++) cache.save(`scope-${i}`, snapshot(), context);
    expect(cache.read('scope-0', context)).toBeUndefined();
    expect(cache.read('scope-16', context)).toEqual(snapshot());
    cache.save('scope-1', snapshot(), context);
    cache.save('scope-17', snapshot(), context);
    expect(cache.read('scope-2', context)).toBeUndefined();
    expect(cache.read('scope-1', context)).toEqual(snapshot());
    const fresh = createSnapshotCache({ storage: () => fixture.storage });
    expect(fresh.read('scope-16', context)).toEqual(snapshot());
    expect(fresh.read('scope-2', context)).toBeUndefined();
  });

  it('guards envelope UTF-8 bytes before JSON parsing', () => {
    const fixture = storageFixture();
    fixture.values.set(
      key,
      JSON.stringify({
        version: 1,
        scopes: [
          { scope: 'scope', snapshot: snapshot() },
          { scope: '中'.repeat(180_000), snapshot: snapshot() },
        ],
      }),
    );
    expect(fixture.values.get(key)!.length).toBeLessThan(524_288);
    expect(
      createSnapshotCache({ storage: () => fixture.storage }).read('scope', context),
    ).toBeUndefined();
  });

  it('prefers valid memory after a persistence failure', () => {
    const fixture = storageFixture();
    const cache = createSnapshotCache({ storage: () => fixture.storage });
    cache.save('scope', snapshot(), context);
    fixture.fail('setItem');
    const ctx = { ...context, now: now + 1 };
    const newer = {
      version: 1 as const,
      savedAt: ctx.now,
      view: { ...view, zoom: 12 },
      panel: { mode: 'closed' as const },
    };
    cache.save('scope', newer, ctx);
    fixture.fail(undefined);
    expect(cache.read('scope', ctx)).toEqual(newer);
  });

  it('does not apply one dataset to another saved scope', () => {
    const fixture = storageFixture();
    const cache = createSnapshotCache({ storage: () => fixture.storage });
    const other = { ...context, index: createPostIndex([b]) };
    cache.save('a', snapshot(), context);
    cache.save(
      'b',
      {
        version: 1,
        savedAt: now,
        view,
        panel: { mode: 'single', urls: [b.url], scroll: { top: 1 } },
      },
      other,
    );
    expect(
      createSnapshotCache({ storage: () => fixture.storage }).read('a', context)?.panel,
    ).toEqual({ mode: 'single', urls: [a.url], scroll: { top: 4 } });
    expect(cache.read('a', other)?.panel).toEqual({ mode: 'closed' });
    expect(cache.read('a', context)?.panel.mode).toBe('single');
  });

  it('rejects corrupt oversized unknown-field and expired storage state', () => {
    for (const value of [
      '{broken',
      ' '.repeat(524_289),
      JSON.stringify({ version: 2, scopes: [] }),
      JSON.stringify({ version: 1, scopes: [], credentials: 'secret' }),
      JSON.stringify({
        version: 1,
        scopes: [
          {
            scope: 'scope',
            snapshot: { version: 1, savedAt: now, view, panel: { mode: 'closed' }, body: 'secret' },
          },
        ],
      }),
    ]) {
      const fixture = storageFixture();
      fixture.values.set(key, value);
      expect(
        createSnapshotCache({ storage: () => fixture.storage }).read('scope', context),
      ).toBeUndefined();
    }
    const fixture = storageFixture();
    const cache = createSnapshotCache({ storage: () => fixture.storage });
    cache.save('scope', snapshot(), context);
    expect(cache.read('scope', { ...context, now: now + 7_200_000 })).toBeUndefined();
    expect(
      createSnapshotCache({ storage: () => fixture.storage }).read('scope', {
        ...context,
        now: now - 1,
      }),
    ).toBeUndefined();
    fixture.values.set(
      key,
      JSON.stringify({
        version: 1,
        scopes: Array.from({ length: 17 }, (_, i) => ({
          scope: `scope-${i}`,
          snapshot: { version: 1, savedAt: now + i, view, panel: { mode: 'closed' } },
        })),
      }),
    );
    const fresh = createSnapshotCache({ storage: () => fixture.storage });
    expect(fresh.read('scope-0', { ...context, now: now + 20 })).toBeUndefined();
    expect(fresh.read('scope-16', { ...context, now: now + 20 })).toBeDefined();
  });

  it('removes only the requested plugin record and never clears other keys', () => {
    const fixture = storageFixture();
    const cache = createSnapshotCache({ storage: () => fixture.storage });
    cache.save('a', snapshot(), context);
    cache.save('b', snapshot(), context);
    cache.remove('a');
    expect(cache.read('a', context)).toBeUndefined();
    expect(cache.read('b', context)).toEqual(snapshot());
    expect(
      createSnapshotCache({ storage: () => fixture.storage }).read('a', context),
    ).toBeUndefined();
    cache.remove('b');
    expect(fixture.values.has(key)).toBe(false);
    expect([...fixture.values]).toEqual([['theme-session', 'keep']]);
    expect(fixture.calls.every((call) => call.endsWith(key))).toBe(true);
  });

  it('shares one document cache and delays all storage access', () => {
    let accesses = 0;
    const owner = {
      get sessionStorage() {
        accesses++;
        throw Error('disabled');
      },
    } as unknown as Window;
    const cache = getDocumentSnapshotCache(owner);
    expect(getDocumentSnapshotCache(owner)).toBe(cache);
    expect(accesses).toBe(0);
    cache.save('scope', snapshot(), context);
    expect(cache.read('scope', context)).toEqual(snapshot());
    expect(accesses).toBeGreaterThan(0);
    const another = getDocumentSnapshotCache({} as Window);
    expect(another.read('scope', context)).toBeUndefined();
  });
});
