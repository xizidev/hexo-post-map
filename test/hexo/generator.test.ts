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
  it('keeps same-origin thumbnails outside the blog root absolute and normalizes only root members', () => {
    const urls = [
      'https://example.com/images/a.jpg?size=2&crop=1#preview',
      'https://example.com/blogger/a.jpg',
      'https://example.com/blog%2Fimages/a.jpg',
      'https://example.com/blog/../images/a.jpg',
      'https://example.com/blog/images/a.jpg?size=2&crop=1#preview',
      'https://example.com/bl%6Fg/images/a.jpg',
    ];
    const routes = generate(
      urls.map((thumbnail) => post({ thumbnail })),
      instance('/blog/'),
    );
    const images = data(routes).posts.map((p: { image: string }) => p.image);
    expect(images).toEqual([
      'https://example.com/images/a.jpg?size=2&crop=1#preview',
      'https://example.com/blogger/a.jpg',
      'https://example.com/blog%2Fimages/a.jpg',
      'https://example.com/blog/../images/a.jpg',
      '/blog/images/a.jpg?size=2&crop=1#preview',
      '/blog/images/a.jpg',
    ]);
    expect(document(routes).querySelector('img')!.getAttribute('src')).toBe(urls[0]);
  });
  it('keeps same-origin permalinks outside the blog root absolute and respects path segment boundaries', () => {
    const urls = [
      'https://example.com/elsewhere/post/?x=1&y=2#section',
      'https://example.com/blogger/post/',
      'https://example.com/blog%2fpost/',
      'https://example.com/blog/%2e%2e/elsewhere/post/',
      'https://example.com/blog/archives/post/?x=1&y=2#section',
      'https://example.com/bl%6fg/archives/post/',
      'https://example.com/blog?x=1#section',
      'https://example.com/blog//blog/post/',
    ];
    const routes = generate(
      urls.map((permalink) => post({ path: undefined, permalink })),
      instance('/blog/'),
    );
    expect(data(routes).posts.map((p: { url: string }) => p.url)).toEqual([
      'https://example.com/elsewhere/post/?x=1&y=2#section',
      'https://example.com/blogger/post/',
      'https://example.com/blog%2fpost/',
      'https://example.com/blog/%2e%2e/elsewhere/post/',
      '/blog/archives/post/?x=1&y=2#section',
      '/blog/archives/post/',
      '/blog/?x=1#section',
      '/blog/blog/post/',
    ]);
    expect(document(routes).querySelector('[data-hpm-fallback] a')!.getAttribute('href')).toBe(
      urls[0],
    );
  });
  it.each(['/', '/blog/'])(
    'preserves encoded query and fragment delimiters in absolute post and image paths at root %s',
    (root) => {
      const urls = [
        `https://example.com${root}archives/question%3Fmark/`,
        `https://example.com${root}images/hash%23name.jpg`,
        `https://example.com${root}archives/mixed%3fpart%23end/?size=a%3Fb#view%23part`,
      ];
      const routes = generate(
        urls.map((url) => post({ path: undefined, permalink: url, thumbnail: url })),
        instance(root),
      );
      const posts = data(routes).posts;
      expect(posts.map((p: { url: string }) => p.url)).toEqual(urls);
      expect(posts.map((p: { image: string }) => p.image)).toEqual(urls);
      const doc = document(routes);
      expect(
        Array.from(doc.querySelectorAll('[data-hpm-fallback] a'), (a) => a.getAttribute('href')),
      ).toEqual(urls);
      expect(Array.from(doc.querySelectorAll('img'), (img) => img.getAttribute('src'))).toEqual(
        urls,
      );
    },
  );
  it.each(['/', '/blog/'])(
    'preserves encoded local paths and query/fragment boundaries at root %s',
    (root) => {
      const routes = generate(
        [
          post({ path: 'archives/question%3Fmark/', thumbnail: '/images/hash%23name.jpg' }),
          post({
            path: `${root}archives/mixed%3f%23%252f/`,
            thumbnail: `${root}images/a%2Fb%5Cc%25.jpg`,
          }),
          post({
            path: 'archives/plain/?q=a%3Fb%23c#view%23part',
            content: '<img src="/images/from%23content.jpg?x=%3F#part%23one">',
          }),
          post({ path: 'archives/%e4%b8%8a%E6%B5%B7/', thumbnail: '/images/hello world.jpg' }),
          post({ path: `${root}archives/__hpm_escape_0__%3Fmark/` }),
        ],
        instance(root),
      );
      expect(data(routes).posts.map((p: { url: string }) => p.url)).toEqual([
        `${root}archives/question%3Fmark/`,
        `${root}archives/mixed%3f%23%252f/`,
        `${root}archives/plain/?q=a%3Fb%23c#view%23part`,
        `${root}archives/%e4%b8%8a%E6%B5%B7/`,
        `${root}archives/__hpm_escape_0__%3Fmark/`,
      ]);
      expect(data(routes).posts.map((p: { image: string }) => p.image)).toEqual([
        `${root}images/hash%23name.jpg`,
        `${root}images/a%2Fb%5Cc%25.jpg`,
        `${root}images/from%23content.jpg?x=%3F#part%23one`,
        `${root}images/hello%20world.jpg`,
        `${root}hexo-post-map/assets/placeholder.svg`,
      ]);
    },
  );
  it.each(['/', '/blog/'])(
    'rejects local traversal without damaging literal escapes (%s)',
    (root) => {
      const routes = generate(
        [
          post({ path: '../outside/', thumbnail: `${root}images/%2e%2E/outside.jpg` }),
          post({ path: 'archives/%2e%2E/outside/' }),
          post({ path: 'archives/%252e%252e/literal/' }),
        ],
        instance(root),
      );
      expect(data(routes).posts.map((p: { url: string }) => p.url)).toEqual([
        '',
        '',
        `${root}archives/%252e%252e/literal/`,
      ]);
      expect(data(routes).posts[0].image).toBe(`${root}hexo-post-map/assets/placeholder.svg`);
    },
  );
  it('tries safe content images after final URL validation rejects the thumbnail, then falls back to the placeholder', () => {
    const routes = generate(
      [
        post({
          thumbnail: 'https://user:secret@example.com/blog/cover.jpg',
          content: '<img src="/body.jpg">',
        }),
        post({
          thumbnail: 'https://user:secret@images.example/cover.jpg',
          content:
            '<img src="https://user:secret@images.example/unsafe.jpg"><img src="javascript:alert(1)"><img src="https://images.example/body.jpg">',
        }),
        post({
          thumbnail: 'https://user:secret@example.com/blog/cover.jpg',
          content: '<img src="https://user:secret@images.example/unsafe.jpg">',
        }),
      ],
      instance('/blog/'),
    );
    expect(data(routes).posts.map((p: { image: string }) => p.image)).toEqual([
      '/blog/body.jpg',
      'https://images.example/body.jpg',
      '/blog/hexo-post-map/assets/placeholder.svg',
    ]);
    expect(String(routes.find((route) => route.path === 'map/posts.json')!.data)).not.toContain(
      'secret',
    );
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
  it('registers namespaced asset routes with fresh data functions', () => {
    const routes = generate();
    for (const file of ['post-map.js', 'overview-map.js', 'style.css', 'placeholder.svg']) {
      expect(typeof routes.find((r) => r.path === `hexo-post-map/assets/${file}`)!.data).toBe(
        'function',
      );
    }
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
