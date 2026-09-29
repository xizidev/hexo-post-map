import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

const directory = process.env.HPM_INTEGRATION_SITE;
const root = process.env.HPM_INTEGRATION_ROOT ?? '/';
const theme = process.env.HPM_INTEGRATION_THEME ?? 'cactus-minimal';
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

describe.skipIf(!directory)('installed tarball generated output', () => {
  it('projects only public fields and sorts the complete mapped-post fallback', async () => {
    const envelope = JSON.parse(await readFile(join(directory!, 'map/posts.json'), 'utf8'));
    expect(envelope.version).toBe(1);
    expect(envelope.posts).toHaveLength(4);
    expect(envelope.posts.map((post: { url: string }) => post.url)).toEqual([
      `${root}posts/overlap/`,
      `${root}posts/route/`,
      `${root}posts/multi/`,
      `${root}posts/single/`,
    ]);
    for (const post of envelope.posts) {
      expect(Object.keys(post).sort()).toEqual(['date', 'image', 'location', 'title', 'url']);
      expect(Object.keys(post.location).sort()).toEqual(['latitude', 'longitude', 'name']);
    }
    const document = await html('map');
    expect(
      [...document.querySelectorAll('[data-hpm-fallback] a')].map((link) =>
        link.getAttribute('href'),
      ),
    ).toEqual(envelope.posts.map((post: { url: string }) => post.url));
    expect(document.querySelectorAll('[data-hpm-fallback] img')).toHaveLength(0);
    expect(document.querySelector('[data-hpm-overview] script')?.textContent).toContain(
      `${root}map/posts.json`,
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
      ['map/index.html', { detail: 0, overview: 1 }],
      // Landscape/NexT render the four mapped posts; Cactus lists titles only.
      ['index.html', { detail: theme === 'cactus-minimal' ? 0 : 4, overview: 0 }],
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
    for (const slug of ['single', 'multi', 'route', 'overlap']) {
      const document = await html(`posts/${slug}`);
      expect(document.querySelectorAll('[data-hpm-detail]')).toHaveLength(1);
      expect(
        document.querySelectorAll('[data-hpm-detail] [data-hpm-fallback] a').length,
      ).toBeGreaterThan(0);
    }
    const ordinary = await html('posts/plain');
    expect(ordinary.querySelector('[data-hpm-detail], [data-hpm-overview]')).toBeNull();
    expect(ordinary.querySelector('link[href*="hexo-post-map/assets/"]')).toBeNull();
    const overview = await html('map');
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
});
