import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import Hexo from 'hexo';
import type { SiteLocals } from 'hexo/dist/types';
import registerHelpers from 'hexo/dist/plugins/helper';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/config/resolve';
import {
  createOverviewRoutes,
  type HexoRoute,
  type OverviewSourcePost,
} from '../../src/hexo/generator';
import { registerPlugin } from '../../src/hexo/register';

const rawConfig = {
  enabled: true,
  amap: { key: 'public-api-key', security: { security_js_code: 'public-security-code' } },
};
const onePoint = {
  points: [{ id: 'shanghai', name: '上海', longitude: 121.4737, latitude: 31.2304 }],
};
function config(overview: Record<string, unknown> = {}) {
  return resolveConfig({ ...rawConfig, overview }, {})!;
}
function instance(root = '/', page = true) {
  const hexo = new Hexo('/tmp/hpm-generator');
  hexo.config.root = root;
  hexo.config.url = `https://example.com${root}`;
  registerHelpers(hexo);
  if (page) hexo.theme.setView('page.ejs', '<%- page.content %>');
  return hexo;
}
function post(overrides: Partial<OverviewSourcePost> = {}): OverviewSourcePost {
  return {
    source: '_posts/private-source.md',
    title: '旅行',
    path: 'archives/travel/',
    permalink: 'https://example.com/archives/travel/',
    date: new Date('2026-09-01T08:00:00+08:00'),
    published: true,
    content: '<p>Private article body</p>',
    map: onePoint,
    ...overrides,
  };
}
function generate(posts: OverviewSourcePost[] = [], hexo = instance(), options = config()) {
  return createOverviewRoutes({ posts: { toArray: () => posts } }, options, hexo);
}
function data(routes: HexoRoute[], path = 'map/posts.json') {
  return JSON.parse(String(routes.find((route) => route.path === path)!.data));
}
function document(routes: HexoRoute[], path = 'map/index.html') {
  const route = routes.find((route) => route.path === path)!;
  const html =
    typeof route.data === 'string' ? route.data : (route.data as { content: string }).content;
  const window = new Window();
  window.document.write(html);
  return window.document;
}

describe('overview generation', () => {
  it('is a no-op without enabled plugin configuration, including malformed map data', () => {
    expect(
      createOverviewRoutes({ posts: { toArray: () => [post({ map: null })] } }, null, instance()),
    ).toEqual([]);
  });
  it('projects only published mapped posts using representative coordinates without merging duplicates', () => {
    const routes = generate([
      post({ title: 'Earlier' }),
      post({
        title: 'Latest',
        date: new Date('2026-09-12T00:00:00Z'),
        map: {
          representative: 'summit',
          points: [
            onePoint.points[0],
            { id: 'summit', name: '山顶', longitude: 114.1735, latitude: 27.4568 },
          ],
          route: ['shanghai', 'summit'],
        },
      }),
      post({ title: 'Same location', path: 'archives/same/' }),
      post({ map: undefined }),
      post({ published: false, map: null }),
    ]);
    expect(data(routes)).toEqual({
      version: 1,
      posts: [
        {
          title: 'Latest',
          url: '/archives/travel/',
          date: '2026-09-12T00:00:00.000Z',
          image: '/hexo-post-map/assets/placeholder.svg',
          location: { name: '山顶', longitude: 114.1735, latitude: 27.4568 },
        },
        {
          title: 'Earlier',
          url: '/archives/travel/',
          date: '2026-09-01T00:00:00.000Z',
          image: '/hexo-post-map/assets/placeholder.svg',
          location: { name: '上海', longitude: 121.4737, latitude: 31.2304 },
        },
        {
          title: 'Same location',
          url: '/archives/same/',
          date: '2026-09-01T00:00:00.000Z',
          image: '/hexo-post-map/assets/placeholder.svg',
          location: { name: '上海', longitude: 121.4737, latitude: 31.2304 },
        },
      ],
    });
    expect(
      [...document(routes).querySelectorAll('[data-hpm-fallback] a')].map((a) => a.textContent),
    ).toEqual(['Latest', 'Earlier', 'Same location']);
    const json = String(routes.find((r) => r.path === 'map/posts.json')!.data);
    for (const secret of [
      'private-source',
      'Private article body',
      'public-api-key',
      'public-security-code',
      'representative',
      'route',
    ])
      expect(json).not.toContain(secret);
  });
  it.each(['/', '/blog/'])(
    'honors root %s for links, JSON, local images and placeholder',
    (root) => {
      const routes = generate(
        [
          post({ path: 'archives/custom-permalink/', thumbnail: '/images/cover.jpg' }),
          post({ content: '<img src="/images/body.jpg">', thumbnail: 'javascript:alert(1)' }),
          post({ path: `${root}archives/already-rooted/` }),
          post({
            path: undefined,
            permalink: `https://example.com${root}archives/permalink-only/`,
          }),
        ],
        instance(root),
        config({ path: 'travel/map/' }),
      );
      expect(routes.map((route) => route.path)).toContain('travel/map/index.html');
      const posts = data(routes, 'travel/map/posts.json').posts;
      expect(posts.map((p: { url: string }) => p.url)).toEqual([
        `${root}archives/custom-permalink/`,
        `${root}archives/travel/`,
        `${root}archives/already-rooted/`,
        `${root}archives/permalink-only/`,
      ]);
      expect(posts.map((p: { image: string }) => p.image)).toEqual([
        `${root}images/cover.jpg`,
        `${root}images/body.jpg`,
        `${root}hexo-post-map/assets/placeholder.svg`,
        `${root}hexo-post-map/assets/placeholder.svg`,
      ]);
      const doc = document(routes, 'travel/map/index.html');
      const model = JSON.parse(doc.querySelector('[data-hpm-data]')!.textContent!);
      expect(model.dataUrl).toBe(`${root}travel/map/posts.json`);
      expect(model.placeholderUrl).toBe(`${root}hexo-post-map/assets/placeholder.svg`);
    },
  );
  it('prefers thumbnail, then first safe rendered image, then placeholder', () => {
    const routes = generate([
      post({ thumbnail: 'https://images.example/cover.jpg', content: '<img src="/body.jpg">' }),
      post({
        thumbnail: 'javascript:alert(1)',
        content: '<img src="data:x"><img src="https://images.example/body.jpg">',
      }),
      post({ thumbnail: 'data:x', content: '<p>No image</p>' }),
    ]);
    expect(data(routes).posts.map((p: { image: string }) => p.image)).toEqual([
      'https://images.example/cover.jpg',
      'https://images.example/body.jpg',
      '/hexo-post-map/assets/placeholder.svg',
    ]);
    for (const image of document(routes).querySelectorAll('img')) {
      expect(image.getAttribute('loading')).toBe('lazy');
      expect(Number(image.getAttribute('width'))).toBeGreaterThan(0);
      expect(Number(image.getAttribute('height'))).toBeGreaterThan(0);
      expect(image.getAttribute('alt')).toBe('旅行');
    }
  });
  it('escapes titles and location names and refuses unsafe post links', () => {
    const title = '</script><img src=x onerror=alert(1)> & "title"';
    const routes = generate(
      [
        post({ title, map: { points: [{ ...onePoint.points[0], name: title }] } }),
        post({ title: 'Unsafe', path: 'javascript:alert(1)', permalink: 'javascript:alert(1)' }),
      ],
      instance(),
      config({ title }),
    );
    const doc = document(routes);
    expect(doc.querySelector('h1')!.textContent).toBe(title);
    expect(doc.querySelector('[data-hpm-fallback] a')!.textContent).toBe(title);
    expect(doc.querySelector('[onerror]')).toBeNull();
    expect(data(routes).posts[1].url).toBe('');
    expect(doc.querySelectorAll('[data-hpm-fallback] a')).toHaveLength(1);
    expect(doc.querySelector('[data-hpm-fallback]')!.textContent).toContain('Unsafe');
    expect(data(routes).posts[0].title).toBe(title);
    expect(doc.querySelectorAll('script')).toHaveLength(1);
    expect(String(routes.find((r) => r.path === 'map/posts.json')!.data)).not.toContain(
      '</script>',
    );
  });
  it('preserves safe external HTTP(S) permalinks', () => {
    expect(
      data(generate([post({ path: undefined, permalink: 'https://other.example/trip/' })])).posts[0]
        .url,
    ).toBe('https://other.example/trip/');
  });
  it('uses theme page layout and exposes the overview page type', () => {
    const route = generate()[0]!;
    expect(route.layout).toEqual(['page']);
    expect(route.data).toMatchObject({ title: '足迹地图', type: 'post-map-overview' });
    expect(document(generate()).querySelector('[data-hpm-overview]')).not.toBeNull();
  });
  it.each([false, true])(
    'provides complete standalone HTML with assets when page layout cannot be used (%s)',
    (explicit) => {
      const routes = generate(
        [],
        instance('/blog/', explicit),
        config(explicit ? { layout: 'standalone' } : {}),
      );
      const route = routes[0]!;
      expect(route.layout).toBeUndefined();
      expect(String(route.data)).toMatch(/^<!doctype html>/i);
      const doc = document(routes);
      expect(doc.title).toBe('足迹地图');
      expect(doc.querySelector('meta[name="viewport"]')).not.toBeNull();
      expect(doc.querySelector('link[rel="stylesheet"]')!.getAttribute('href')).toBe(
        '/blog/hexo-post-map/assets/style.css',
      );
      expect(doc.querySelector('script[src]')!.getAttribute('src')).toBe(
        '/blog/hexo-post-map/assets/overview-map.js',
      );
    },
  );
  it('renders a readable empty state and empty versioned data', () => {
    const routes = generate();
    expect(data(routes)).toEqual({ version: 1, posts: [] });
    expect(document(routes).querySelector('[data-hpm-empty]')!.textContent).toMatch(/暂无/);
  });
  it('fails invalid published map metadata through domain validation', () => {
    expect(() => generate([post({ map: { points: [] } })])).toThrowError(
      expect.objectContaining({ sourcePath: '_posts/private-source.md', fieldPath: 'map.points' }),
    );
  });
  it('keeps assets available for detail maps when overview is disabled', () => {
    expect(
      generate([post({ map: null })], instance(), config({ enabled: false })).map((r) => r.path),
    ).toEqual([
      'hexo-post-map/assets/post-map.js',
      'hexo-post-map/assets/overview-map.js',
      'hexo-post-map/assets/style.css',
      'hexo-post-map/assets/placeholder.svg',
    ]);
  });
  it('serves namespaced bundled assets through reusable stream factories', async () => {
    await promisify(execFile)(process.execPath, ['scripts/build.mjs']);
    const routes = generate();
    for (const file of ['post-map.js', 'overview-map.js', 'style.css', 'placeholder.svg']) {
      expect(typeof routes.find((r) => r.path === `hexo-post-map/assets/${file}`)!.data).toBe(
        'function',
      );
    }
    // Exercise stream resolution from the published CommonJS entry, whose directory owns assets/.
    const { stdout } = await promisify(execFile)(process.execPath, [
      '-e',
      `
      const Hexo = require('hexo');
      global.hexo = new Hexo('/tmp/hpm-generator-bundle');
      hexo.config.post_map = ${JSON.stringify({ ...rawConfig, overview: { enabled: false } })};
      require('./dist/index.cjs');
      (async () => {
        const routes = await hexo.extend.generator.get('post-map')(hexo.locals.toObject());
        const route = routes.find(r => r.path === 'hexo-post-map/assets/placeholder.svg');
        for (let i = 0; i < 2; i++) {
          for await (const chunk of route.data()) process.stdout.write(chunk);
        }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `,
    ]);
    expect(stdout).toBe((await readFile('src/browser/styles/placeholder.svg', 'utf8')).repeat(2));
  });
});

describe('overview registration', () => {
  it('registers no generator when plugin is disabled', () => {
    const hexo = instance();
    registerPlugin(hexo);
    expect(Object.keys(hexo.extend.generator.list())).toEqual([]);
  });
  it('registers one generator alongside existing post hooks and produces routes', async () => {
    const hexo = instance();
    hexo.config.post_map = rawConfig;
    registerPlugin(hexo);
    expect(Object.keys(hexo.extend.generator.list())).toEqual(['post-map']);
    const routes = await hexo.extend.generator
      .get('post-map')!
      .call(hexo, hexo.locals.toObject() as SiteLocals);
    expect(routes).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'map/posts.json' })]),
    );
    expect(hexo.extend.filter.list()['after_post_render']).toHaveLength(1);
    expect(hexo.extend.filter.list()['_after_html_render']).toHaveLength(1);
  });
});
