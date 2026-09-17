import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

const directory = process.env.HPM_INTEGRATION_SITE;
const root = process.env.HPM_INTEGRATION_ROOT ?? '/';
const html = async (path: string) => {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  window.document.write(await readFile(join(directory!, path, 'index.html'), 'utf8'));
  return window.document;
};

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

  it('emits one detail component per mapped article and no assets on ordinary posts', async () => {
    for (const slug of ['single', 'multi', 'route', 'overlap']) {
      const document = await html(`posts/${slug}`);
      expect(document.querySelectorAll('[data-hpm-detail]')).toHaveLength(1);
      expect(
        document.querySelectorAll(`script[src="${root}hexo-post-map/assets/post-map.js"]`),
      ).toHaveLength(1);
      expect(
        document.querySelectorAll(`link[href="${root}hexo-post-map/assets/style.css"]`),
      ).toHaveLength(1);
    }
    const ordinary = await html('posts/plain');
    expect(ordinary.querySelector('[data-hpm-detail]')).toBeNull();
    expect(ordinary.querySelector('[src*="hexo-post-map"], [href*="hexo-post-map"]')).toBeNull();
    const overview = await html('map');
    expect(
      overview.querySelectorAll(`script[src="${root}hexo-post-map/assets/overview-map.js"]`),
    ).toHaveLength(1);
    for (const name of ['post-map.js', 'overview-map.js', 'style.css', 'placeholder.svg'])
      expect(
        (await readFile(join(directory!, 'hexo-post-map/assets', name))).length,
      ).toBeGreaterThan(0);
  });
});
