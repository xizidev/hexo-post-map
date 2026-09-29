import { Window } from 'happy-dom';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/config/resolve';
import { PostMapValidationError } from '../../src/domain/errors';
import { createPostFilter } from '../../src/hexo/post-filter';
import { postMapTag } from '../../src/hexo/tag';
import { createTrackCompiler } from '../../src/tracks/compiler';

const onePoint = {
  points: [{ id: 'shanghai', name: '上海', longitude: 121.4737, latitude: 31.2304 }],
};
const source = 'source/_posts/a.md';
const body = '<p>Body</p>';
const temporaryDirectories: string[] = [];
afterEach(() =>
  temporaryDirectories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true })),
);
function compiler() {
  const sourceDir = mkdtempSync(join(tmpdir(), 'hpm-filter-track-'));
  temporaryDirectories.push(sourceDir);
  mkdirSync(join(sourceDir, '_posts/nested'), { recursive: true });
  writeFileSync(
    join(sourceDir, '_posts/nested/private-track.geojson'),
    JSON.stringify({
      type: 'Feature',
      properties: { name: 'PRIVATE_NAME', timestamp: 'PRIVATE_TIMESTAMP' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0, 10],
          [0.001, 0, 20],
        ],
      },
    }),
  );
  return createTrackCompiler(sourceDir);
}
function config(post: Record<string, unknown> = {}) {
  return resolveConfig(
    { enabled: true, post, amap: { key: 'key', security: { security_js_code: 'code' } } },
    {},
  );
}

describe('post filter', () => {
  it.each(['/', '/blog/'])(
    'embeds only a root-aware digest URL and sanitized stats under %s',
    (root) => {
      const result = createPostFilter(
        config(),
        compiler(),
        root,
      )({
        source: '_posts/nested/trip.md',
        content: body,
        map: { ...onePoint, track: { source: 'private-track.geojson' } },
      });
      const window = new Window();
      window.document.body.innerHTML = result.content;
      const embedded = JSON.parse(window.document.querySelector('[data-hpm-data]')!.textContent!);
      expect(embedded.track?.url).toMatch(
        new RegExp(`^${root}hexo-post-map/tracks/[a-f0-9]{64}\\.json$`),
      );
      expect(embedded.track).toEqual({
        url: embedded.track.url,
        stats: { distanceMeters: 111.195, elevationGainMeters: 10 },
        playback: true,
      });
      expect(embedded.map.points[0].coordinate).toEqual([121.4737, 31.2304]);
      expect(result.content).not.toMatch(
        /private-track|PRIVATE_NAME|PRIVATE_TIMESTAMP|_posts|source/,
      );
    },
  );

  it('does not read tracks when detail maps are disabled or manual placement is absent', () => {
    const map = { ...onePoint, track: { source: 'missing.gpx' } };
    for (const options of [{ enabled: false }, { position: 'manual' }]) {
      expect(
        createPostFilter(config(options), compiler())({ source: '_posts/a.md', content: body, map })
          .content,
      ).toBe(body);
    }
  });

  it('fails invalid track sources before rendering a partial tracked section', () => {
    expect(() =>
      createPostFilter(
        config(),
        compiler(),
      )({
        source: '_posts/nested/trip.md',
        content: body,
        map: { ...onePoint, track: { source: 'missing.gpx' } },
      }),
    ).toThrowError(
      expect.objectContaining({ name: 'TrackBuildError', sourcePath: '_posts/nested/trip.md' }),
    );
  });

  it.each(['//evil.example/', '/blog/?query=', '/blog/#hash'])(
    'rejects an unsafe root %s for track URLs',
    (root) => {
      expect(() =>
        createPostFilter(
          config(),
          compiler(),
          root,
        )({
          source: '_posts/nested/trip.md',
          content: body,
          map: { ...onePoint, track: { source: 'private-track.geojson' } },
        }),
      ).toThrow(/root/);
    },
  );

  it('leaves content and invalid metadata untouched without plugin config', () => {
    const post = { source, content: body, map: null };
    expect(createPostFilter(null)(post)).toBe(post);
    expect(post.content).toBe(body);
  });
  it('leaves posts without map unchanged', () => {
    expect(createPostFilter(config())({ source, content: body }).content).toBe(body);
  });
  it.each(['before', 'after'] as const)('inserts one map in %s mode', (position) => {
    const result = createPostFilter(config({ position }))({ source, content: body, map: onePoint });
    expect(result.content.match(/data-hpm-detail/g)).toHaveLength(1);
    expect(
      position === 'before' ? result.content.endsWith(body) : result.content.startsWith(body),
    ).toBe(true);
    expect(result.content).toContain('<section class="hpm-detail" data-hpm-detail');
  });
  it.each(['before', 'after', 'manual'] as const)(
    'uses the sentinel placement in %s mode',
    (position) => {
      const result = createPostFilter(config({ position }))({
        source,
        content: `<p>First</p>${postMapTag()}${body}`,
        map: onePoint,
      });
      expect(result.content).toMatch(/^<p>First<\/p><section/);
      expect(result.content.endsWith(body)).toBe(true);
      expect(result.content.match(/data-hpm-detail/g)).toHaveLength(1);
      expect(result.content).not.toContain(postMapTag());
    },
  );
  it('preserves map metadata when manual placement is absent', () => {
    const result = createPostFilter(config({ position: 'manual' }))({
      source,
      content: body,
      map: onePoint,
    });
    expect(result.content).toBe(body);
    expect(result.map).toBe(onePoint);
  });
  it.each([{}, { enabled: false }])(
    'removes the sentinel when no detail can render: %j',
    (postConfig) => {
      const result = createPostFilter(config(postConfig))({
        source,
        content: `${body}${postMapTag()}`,
        ...(postConfig.enabled === false ? { map: onePoint } : {}),
      });
      expect(result.content).toBe(body);
    },
  );
  it('reports source and field for invalid metadata even in manual mode', () => {
    expect(() =>
      createPostFilter(config({ position: 'manual' }))({ source, content: body, map: {} }),
    ).toThrowError(expect.objectContaining({ sourcePath: source, fieldPath: 'map.points' }));
  });
  it('rejects multiple manual tags with structured diagnostics', () => {
    expect(() =>
      createPostFilter(config())({ source, content: postMapTag() + postMapTag(), map: onePoint }),
    ).toThrowError(
      expect.objectContaining({
        sourcePath: source,
        fieldPath: 'post_map',
        name: 'PostMapValidationError',
      }),
    );
  });
  it('does not insert duplicate components when invoked twice', () => {
    const filter = createPostFilter(config());
    const first = filter({ source, content: body, map: onePoint });
    const rendered = first.content;
    expect(filter(first).content).toBe(rendered);
  });
  it('keeps a readable accessible fallback and safely embeds public map data', () => {
    const name = '</script><img src=x onerror=alert(1)> & "place"';
    const result = createPostFilter(config())({
      source,
      content: body,
      map: { points: [{ ...onePoint.points[0], name }] },
    });
    const window = new Window();
    window.document.body.innerHTML = result.content;
    const document = window.document;
    expect(document.querySelector('[data-hpm-detail]')?.getAttribute('aria-label')).toBe(
      '文章地点地图',
    );
    expect(document.querySelector('[data-hpm-fallback] a')?.textContent).toBe(name);
    expect(document.querySelector('[data-hpm-fallback]')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('noscript, img')).toBeNull();
    expect(document.querySelector('[data-hpm-status]')?.getAttribute('aria-live')).toBe('polite');
    const link = new URL(document.querySelector('a')!.getAttribute('href')!);
    expect(link.origin).toBe('https://uri.amap.com');
    expect(link.searchParams.get('position')).toBe('121.4737,31.2304');
    expect(link.searchParams.get('name')).toBe(name);
    const data = JSON.parse(document.querySelector('[data-hpm-data]')!.textContent!);
    expect(data.map.points[0].name).toBe(name);
    expect(data.defaultZoom).toBe(11);
    expect(data.height).toBe('220px');
    expect(data).not.toHaveProperty('overview');
    expect(data).not.toHaveProperty('source');
  });
  it('retains domain error type', () => {
    expect(() => createPostFilter(config())({ source, content: body, map: null })).toThrow(
      PostMapValidationError,
    );
  });
});
