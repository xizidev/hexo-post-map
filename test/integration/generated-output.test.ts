import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

const directory = process.env.HPM_INTEGRATION_SITE;
const root = process.env.HPM_INTEGRATION_ROOT ?? '/';
const theme = process.env.HPM_INTEGRATION_THEME ?? 'cactus-minimal';
const recordedTracks = process.env.HPM_INTEGRATION_TRACKS === '1';
const overviewPath = process.env.HPM_INTEGRATION_OVERVIEW ?? 'map';
const exploration =
  process.env.HPM_INTEGRATION_EXPLORATION === 'off'
    ? { restore: false, share: false, random: false }
    : { restore: true, share: true, random: false };
const html = async (path: string) => {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  window.document.write(
    await readFile(join(directory!, path.endsWith('.html') ? path : `${path}/index.html`), 'utf8'),
  );
  return window.document;
};

async function htmlPaths(path = ''): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(join(directory!, path), { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) paths.push(...(await htmlPaths(child)));
    else if (entry.name.endsWith('.html')) paths.push(child);
  }
  return paths;
}

async function filePaths(path = ''): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(join(directory!, path), { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) paths.push(...(await filePaths(child)));
    else paths.push(child.replaceAll('\\', '/'));
  }
  return paths;
}

describe.skipIf(!directory)('installed tarball generated output', () => {
  it('emits root-aware overview route and exploration flags without changing detail JSON', async () => {
    const overview = await html(overviewPath);
    const settings = JSON.parse(overview.querySelector('[data-hpm-data]')!.textContent!);
    expect(settings.overviewUrl).toBe(`${root}${overviewPath}/`);
    expect(settings.dataUrl).toBe(`${root}${overviewPath}/posts.json`);
    expect(settings.exploration).toEqual(exploration);
    const detail = JSON.parse(
      (await html('posts/single')).querySelector('[data-hpm-data]')!.textContent!,
    );
    expect(detail).not.toHaveProperty('exploration');
    expect(detail).not.toHaveProperty('overviewUrl');
    expect(
      (await readFile(join(directory!, 'hexo-post-map/assets/runtime.js'))).length,
    ).toBeLessThanOrEqual(8192);
  });
  it('projects only public fields and sorts the complete mapped-post fallback', async () => {
    const envelope = JSON.parse(
      await readFile(join(directory!, overviewPath, 'posts.json'), 'utf8'),
    );
    expect(envelope.version).toBe(1);
    expect(envelope.posts).toHaveLength(recordedTracks ? 6 : 4);
    expect(envelope.posts.map((post: { url: string }) => post.url)).toEqual([
      ...(recordedTracks ? [`${root}posts/tracked-gpx/`, `${root}posts/tracked-geojson/`] : []),
      `${root}posts/overlap/`,
      `${root}posts/route/`,
      `${root}posts/multi/`,
      `${root}posts/single/`,
    ]);
    for (const post of envelope.posts) {
      expect(Object.keys(post).sort()).toEqual(['date', 'image', 'location', 'title', 'url']);
      expect(Object.keys(post.location).sort()).toEqual(['latitude', 'longitude', 'name']);
    }
    const document = await html(overviewPath);
    expect(
      [...document.querySelectorAll('[data-hpm-fallback] a')].map((link) =>
        link.getAttribute('href'),
      ),
    ).toEqual(envelope.posts.map((post: { url: string }) => post.url));
    expect(document.querySelectorAll('[data-hpm-fallback] img')).toHaveLength(0);
    expect(document.querySelector('[data-hpm-overview] script')?.textContent).toContain(
      `${root}${overviewPath}/posts.json`,
    );
    expect(document.querySelector('[data-hpm-overview] img[onerror]')).toBeNull();
    expect(document.querySelector('[data-hpm-overview] [data-attack]')).toBeNull();
    expect(document.querySelector('[data-hpm-fallback]')?.textContent).toContain(
      '<img data-attack',
    );
    expect(envelope.posts[0].image).toBe(`${root}hexo-post-map/assets/placeholder.svg`);
    const overlap = await html('posts/overlap');
    const detail = overlap.querySelector('[data-hpm-detail]')!;
    expect(detail.querySelectorAll('script')).toHaveLength(1);
    expect(detail.querySelector('script')?.getAttribute('type')).toBe('application/json');
    expect(detail.querySelector('[data-hpm-fallback]')?.textContent).toContain(
      '<script>window.hpmAttack=2</script>',
    );
    expect(detail.querySelector('[data-hpm-fallback] script')).toBeNull();
    expect(detail.querySelector('script')?.textContent).not.toContain('<script>');
  });

  it('emits one root-aware runtime on every HTML page and only static map styles', async () => {
    const paths = await htmlPaths();
    expect(paths.length).toBeGreaterThan(5);
    // These routes come from the committed fixture inputs, not generated map markup.
    const expectedRoots = new Map([
      ['posts/single/index.html', { detail: 1, overview: 0 }],
      ['posts/multi/index.html', { detail: 1, overview: 0 }],
      ['posts/route/index.html', { detail: 1, overview: 0 }],
      ['posts/overlap/index.html', { detail: 1, overview: 0 }],
      ...(recordedTracks
        ? ([
            ['posts/tracked-gpx/index.html', { detail: 1, overview: 0 }],
            ['posts/tracked-geojson/index.html', { detail: 1, overview: 0 }],
          ] as const)
        : []),
      [`${overviewPath}/index.html`, { detail: 0, overview: 1 }],
      // Landscape/NexT render every mapped post; Cactus lists titles only.
      [
        'index.html',
        { detail: theme === 'cactus-minimal' ? 0 : recordedTracks ? 6 : 4, overview: 0 },
      ],
    ]);
    for (const path of paths) {
      const document = await html(path);
      const expected = expectedRoots.get(path.replaceAll('\\', '/')) ?? {
        detail: 0,
        overview: 0,
      };
      const mapped = expected.detail + expected.overview > 0;
      expect(
        [...document.querySelectorAll('script[src]')]
          .map((script) => script.getAttribute('src'))
          .filter((src) => src?.includes('hexo-post-map/assets/')),
        path,
      ).toEqual([`${root}hexo-post-map/assets/runtime.js`]);
      expect(
        document.querySelectorAll(`link[href="${root}hexo-post-map/assets/style.css"]`),
        path,
      ).toHaveLength(mapped ? 1 : 0);
      expect(document.querySelectorAll('[data-hpm-detail]'), path).toHaveLength(expected.detail);
      expect(document.querySelectorAll('[data-hpm-overview]'), path).toHaveLength(
        expected.overview,
      );
      if (!mapped) {
        expect(
          document.querySelectorAll(
            '[data-hpm-detail], [data-hpm-overview], .hpm-detail-marker, .hpm-image-marker, .hpm-cluster, .hpm-panel',
          ),
          path,
        ).toHaveLength(0);
        expect(document.querySelectorAll('link[href*="hexo-post-map/assets/"]'), path).toHaveLength(
          0,
        );
      }
    }
    for (const slug of [
      'single',
      'multi',
      'route',
      'overlap',
      ...(recordedTracks ? ['tracked-gpx', 'tracked-geojson'] : []),
    ]) {
      const document = await html(`posts/${slug}`);
      expect(document.querySelectorAll('[data-hpm-detail]')).toHaveLength(1);
      expect(
        document.querySelectorAll('[data-hpm-detail] [data-hpm-fallback] a').length,
      ).toBeGreaterThan(0);
    }
    const ordinary = await html('posts/plain');
    expect(ordinary.querySelector('[data-hpm-detail], [data-hpm-overview]')).toBeNull();
    expect(ordinary.querySelector('link[href*="hexo-post-map/assets/"]')).toBeNull();
    const overview = await html(overviewPath);
    expect(overview.querySelectorAll('[data-hpm-overview]')).toHaveLength(1);
    for (const name of [
      'runtime.js',
      'post-map.js',
      'overview-map.js',
      'style.css',
      'placeholder.svg',
    ])
      expect(
        (await readFile(join(directory!, 'hexo-post-map/assets', name))).length,
      ).toBeGreaterThan(0);
  });

  it.skipIf(!recordedTracks)(
    'publishes content-addressed track JSON without raw authoring data or overview fields',
    async () => {
      const posts = JSON.parse(
        await readFile(join(directory!, overviewPath, 'posts.json'), 'utf8'),
      );
      expect(posts).not.toHaveProperty('track');
      expect(posts.posts.every((post: object) => !Object.hasOwn(post, 'track'))).toBe(true);

      const descriptors = [];
      for (const [slug, playback] of [
        ['tracked-gpx', true],
        ['tracked-geojson', false],
      ] as const) {
        const document = await html(`posts/${slug}`);
        const detail = document.querySelector('[data-hpm-detail]')!;
        const descriptor = JSON.parse(detail.querySelector('[data-hpm-data]')!.textContent!).track;
        expect(descriptor).toEqual({
          url: descriptor.url,
          stats: descriptor.stats,
          playback,
        });
        expect(descriptor.url).toMatch(
          new RegExp(`^${root}hexo-post-map/tracks/[a-f0-9]{64}\\.json$`),
        );
        expect(detail.querySelector('[data-hpm-track-stats]')).not.toBeNull();
        expect(detail.querySelector('[data-hpm-playback]') === null).toBe(!playback);
        descriptors.push(descriptor);
      }

      const pointOnly = JSON.parse(
        (await html('posts/single')).querySelector('[data-hpm-data]')!.textContent!,
      );
      expect(pointOnly).not.toHaveProperty('track');

      const trackFiles = (await readdir(join(directory!, 'hexo-post-map/tracks'))).sort();
      expect(trackFiles).toHaveLength(2);
      expect(trackFiles).toEqual(descriptors.map(({ url }) => url.split('/').at(-1)).sort());
      for (const filename of trackFiles) {
        expect(filename).toMatch(/^[a-f0-9]{64}\.json$/u);
        const serialized = await readFile(
          join(directory!, 'hexo-post-map/tracks', filename),
          'utf8',
        );
        expect(createHash('sha256').update(serialized).digest('hex')).toBe(
          filename.replace(/\.json$/u, ''),
        );
        const asset = JSON.parse(serialized);
        expect(asset.version).toBe(1);
        expect(asset.coordinateSystem).toBe('wgs84');
        expect(asset.segments.length).toBeGreaterThan(0);
        expect(asset.segments.flat()).not.toHaveLength(0);
        expect(asset.segments.flat().length).toBeLessThanOrEqual(2_000);
        expect(Object.keys(asset).sort()).toEqual([
          'coordinateSystem',
          'segments',
          'stats',
          'version',
        ]);
      }

      const paths = await filePaths();
      expect(paths.some((path) => path.endsWith('/kept.svg'))).toBe(true);
      expect(paths.some((path) => /private-recording\.(?:gpx|geojson)$/u.test(path))).toBe(false);
      const publicText = (
        await Promise.all(
          paths
            .filter((path) => /\.(?:html|json|js|css|svg|xml|txt)$/u.test(path))
            .map((path) => readFile(join(directory!, path), 'utf8')),
        )
      ).join('\n');
      expect(publicText).not.toMatch(
        /private-recording|DO_NOT_PUBLISH_(?:GPX|GEOJSON)|2024-01-02T03:04:05Z|source\/_posts/u,
      );
    },
  );
});
