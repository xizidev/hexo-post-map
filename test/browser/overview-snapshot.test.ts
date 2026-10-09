import { describe, expect, it } from 'vitest';
import type { OverviewPost } from '../../src/templates/overview';
import { createPostIndex } from '../../src/browser/overview/post-index';
import {
  createOverviewScope,
  createSnapshot,
  encodeSnapshot,
  readSnapshot,
} from '../../src/browser/overview/snapshot';

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
const context = () => ({ now, maxZoom: 18, index: createPostIndex([a, b]) });
const raw = () => ({ version: 1, savedAt: now, view, panel: { mode: 'closed' } });

describe('overview snapshot protocol', () => {
  it('closes an incomplete group but keeps its view', () => {
    const context = { now, maxZoom: 18, index: createPostIndex([a]) };
    const raw = {
      version: 1,
      savedAt: now,
      view,
      panel: { mode: 'group', urls: [a.url, b.url], scroll: { top: 400 } },
    };
    expect(readSnapshot(raw, context)).toEqual({ ...raw, panel: { mode: 'closed' } });
    expect(readSnapshot({ ...raw, savedAt: now - 7_200_000 }, context)).toBeUndefined();
  });

  it('rejects nonfinite coordinates and unknown snapshot fields', () => {
    expect(readSnapshot(raw(), context())).toEqual(raw());
    for (const center of [
      [NaN, 31],
      [121, Infinity],
      [181, 31],
      [121, -91],
      [121, 31, 1],
    ]) {
      expect(readSnapshot({ ...raw(), view: { ...view, center } }, context())).toBeUndefined();
    }
    expect(readSnapshot({ ...raw(), body: 'secret' }, context())).toBeUndefined();
    expect(readSnapshot({ ...raw(), view: { ...view, extra: true } }, context())).toBeUndefined();
    expect(
      readSnapshot({ ...raw(), panel: { mode: 'closed', urls: [a.url] } }, context()),
    ).toBeUndefined();
    expect(readSnapshot({ ...raw(), view: { ...view, zoom: NaN } }, context())).toBeUndefined();
  });

  it('rejects expired future malformed and unsupported snapshots', () => {
    for (const savedAt of [-1, now + 1, now - 7_200_000, NaN, Infinity]) {
      expect(readSnapshot({ ...raw(), savedAt }, context())).toBeUndefined();
    }
    expect(readSnapshot({ ...raw(), savedAt: now - 7_199_999 }, context())).toBeDefined();
    for (const value of [
      null,
      [],
      '{broken',
      { ...raw(), version: 2 },
      { ...raw(), panel: { mode: 'other' } },
    ]) {
      expect(readSnapshot(value, context())).toBeUndefined();
    }
    expect(readSnapshot(JSON.stringify(raw()), context())).toEqual(raw());
  });

  it('clamps zoom to 2..maxZoom', () => {
    expect(createSnapshot({ ...view, zoom: -10 }, { mode: 'closed' }, context())?.view.zoom).toBe(
      2,
    );
    expect(createSnapshot({ ...view, zoom: 100 }, { mode: 'closed' }, context())?.view.zoom).toBe(
      18,
    );
    expect(readSnapshot({ ...raw(), view: { ...view, zoom: 100 } }, context())?.view.zoom).toBe(18);
    expect(
      createSnapshot(view, { mode: 'closed' }, { ...context(), maxZoom: NaN }),
    ).toBeUndefined();
  });

  it('ignores duplicate URL selection and anchor', () => {
    const ctx = { ...context(), index: createPostIndex([a, a, b]) };
    expect([...ctx.index.unique.keys()]).toEqual([b.url]);
    expect([...ctx.index.ambiguous]).toEqual([a.url]);
    expect(
      readSnapshot({ ...raw(), panel: { mode: 'single', urls: [a.url], scroll: { top: 40 } } }, ctx)
        ?.panel,
    ).toEqual({ mode: 'closed' });
    expect(
      readSnapshot(
        {
          ...raw(),
          panel: { mode: 'all', scroll: { top: 40, anchor: { url: a.url, offset: 12 } } },
        },
        ctx,
      )?.panel,
    ).toEqual({ mode: 'all', scroll: { top: 40 } });
    expect(
      readSnapshot(
        { ...raw(), panel: { mode: 'group', urls: [b.url, b.url], scroll: { top: 40 } } },
        ctx,
      )?.panel,
    ).toEqual({ mode: 'closed' });
  });

  it('indexes only safe credential-free URLs and rejects invalid references', () => {
    const unsafe = [
      'javascript:alert(1)',
      '//example.com/a',
      'https://user:password@example.com/a',
      'https://user@example.com/a',
      'https://@example.com/a',
      'https:@example.com/a',
      '/a\\b',
      ' /a',
      '/' + 'a'.repeat(4096),
    ];
    expect(createPostIndex(unsafe.map((url) => ({ ...a, url }))).unique.size).toBe(0);
    for (const urls of [[], [a.url, b.url], ['/unknown'], unsafe]) {
      expect(
        readSnapshot({ ...raw(), panel: { mode: 'single', urls, scroll: { top: 3 } } }, context())
          ?.panel,
      ).toEqual({ mode: 'closed' });
    }
    const panel = { mode: 'single' as const, urls: [a.url] as const, scroll: { top: 3 } };
    expect(createSnapshot(view, panel, context())).toEqual({ ...raw(), panel });
  });

  it('stores all mode without post array', () => {
    const snapshot = createSnapshot(view, { mode: 'all', scroll: { top: 20 } }, context())!;
    expect(JSON.parse(encodeSnapshot(snapshot, context())!)).toEqual({
      ...raw(),
      panel: { mode: 'all', scroll: { top: 20 } },
    });
  });

  it('bounds scroll and drops a broken anchor while keeping pixel fallback', () => {
    for (const scroll of [
      { top: -2 },
      { top: 2_000_000 },
      { top: Infinity },
      { top: 22, anchor: { url: '/unknown', offset: 1 } },
      { top: 22, anchor: { url: a.url, offset: NaN } },
      { top: 22, anchor: { url: a.url, offset: 1, extra: true } },
    ]) {
      const expected = Number.isFinite(scroll.top)
        ? Math.max(0, Math.min(1_000_000, scroll.top))
        : 0;
      expect(readSnapshot({ ...raw(), panel: { mode: 'all', scroll } }, context())?.panel).toEqual({
        mode: 'all',
        scroll: { top: expected },
      });
    }
    expect(
      readSnapshot(
        {
          ...raw(),
          panel: { mode: 'all', scroll: { top: 1, anchor: { url: a.url, offset: -2_000_000 } } },
        },
        context(),
      )?.panel,
    ).toEqual({ mode: 'all', scroll: { top: 1, anchor: { url: a.url, offset: -1_000_000 } } });
    expect(
      readSnapshot(
        {
          ...raw(),
          panel: { mode: 'all', scroll: { top: 1, anchor: { url: b.url, offset: 2_000_000 } } },
        },
        context(),
      )?.panel,
    ).toEqual({ mode: 'all', scroll: { top: 1, anchor: { url: b.url, offset: 1_000_000 } } });
    expect(
      readSnapshot({ ...raw(), panel: { mode: 'group', urls: [a.url], scroll: null } }, context())
        ?.panel,
    ).toEqual({ mode: 'group', urls: [a.url], scroll: { top: 0 } });
  });

  it('falls back to view-only above 128 refs or 16384 UTF-8 bytes', () => {
    const posts = Array.from({ length: 129 }, (_, i) => ({ ...a, url: `/article/${i}/` }));
    const ctx = { ...context(), index: createPostIndex(posts) };
    expect(
      createSnapshot(
        view,
        { mode: 'group', urls: posts.slice(0, 128).map((post) => post.url), scroll: { top: 0 } },
        ctx,
      )?.panel.mode,
    ).toBe('group');
    expect(
      createSnapshot(
        view,
        { mode: 'group', urls: posts.map((post) => post.url), scroll: { top: 0 } },
        ctx,
      )?.panel,
    ).toEqual({ mode: 'closed' });
    const longPosts = Array.from({ length: 6 }, (_, i) => ({
      ...a,
      url: `/${i}/${'中'.repeat(1000)}`,
    }));
    const longCtx = { ...context(), index: createPostIndex(longPosts) };
    const snapshot = createSnapshot(
      view,
      { mode: 'group', urls: longPosts.map((post) => post.url), scroll: { top: 4 } },
      longCtx,
    )!;
    expect(snapshot.panel).toEqual({ mode: 'closed' });
    expect(new TextEncoder().encode(encodeSnapshot(snapshot, longCtx)).length).toBeLessThanOrEqual(
      16384,
    );
  });

  it('never serializes credentials images bodies or track metadata', () => {
    const richPost = {
      ...a,
      image: 'private-image',
      body: 'private-body',
      track: 'private-track',
      credential: 'private-token',
    };
    const ctx = { ...context(), index: createPostIndex([richPost]) };
    const snapshot = createSnapshot(
      view,
      { mode: 'single', urls: [a.url], scroll: { top: 0 } },
      ctx,
    )!;
    const encoded = encodeSnapshot(
      { ...snapshot, credential: 'private-token' } as typeof snapshot,
      ctx,
    );
    expect(encoded).toBeUndefined();
    expect(JSON.parse(encodeSnapshot(snapshot, ctx)!)).toEqual({
      ...raw(),
      panel: { mode: 'single', urls: [a.url], scroll: { top: 0 } },
    });
  });

  it('isolates ports roots and data paths without decoding separators', () => {
    const scope = createOverviewScope(
      'http://127.0.0.1:4000',
      '/blog/map/?a=1#x',
      '/blog/map/posts.json?v=1#x',
    );
    expect(scope).toBe(
      JSON.stringify([
        'http://127.0.0.1:4000',
        '/blog/map/',
        'http://127.0.0.1:4000',
        '/blog/map/posts.json',
      ]),
    );
    expect(
      createOverviewScope('http://127.0.0.1:4000', '/blog/map/?b=2', '/blog/map/posts.json?v=2'),
    ).toBe(scope);
    for (const args of [
      ['http://127.0.0.1:4001', '/blog/map/', '/blog/map/posts.json'],
      ['http://127.0.0.1:4000', '/other/map/', '/blog/map/posts.json'],
      ['http://127.0.0.1:4000', '/blog/map/', '/blog/other/posts.json'],
      ['http://127.0.0.1:4000', '/blog%2Fmap/', '/blog/map/posts.json'],
      ['http://127.0.0.1:4000', '/blog/map/', 'https://data.example/posts.json'],
    ] as const)
      expect(createOverviewScope(args[0], args[1], args[2])).not.toBe(scope);
    expect(
      createOverviewScope('https://user:password@example.com', '/map/', '/posts.json'),
    ).toBeUndefined();
    expect(createOverviewScope('https://@example.com', '/map/', '/posts.json')).toBeUndefined();
    expect(
      createOverviewScope('https://example.com', 'https://user@example.com/map/', '/posts.json'),
    ).toBeUndefined();
    expect(
      createOverviewScope('https://example.com', '/map/', 'https://user@example.com/posts.json'),
    ).toBeUndefined();
  });
});
