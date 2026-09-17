import Hexo from 'hexo';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPlugin } from '../../src/hexo/register';
import { postMapTag } from '../../src/hexo/tag';

afterEach(() => vi.unstubAllEnvs());

describe('tag and registration', () => {
  it.each([undefined, { enabled: false }])(
    'registers no behavior for disabled config %j',
    (postMap) => {
      const hexo = new Hexo('/tmp/hpm-registration-test');
      hexo.config.post_map = postMap;
      const filters = Object.keys(hexo.extend.filter.list());
      registerPlugin(hexo);
      expect(Object.keys(hexo.extend.filter.list())).toEqual(filters);
      expect(hexo.extend.tag.env.hasExtension('post_map')).toBe(false);
    },
  );
  it('registers functioning tag, post filter and marker-aware html filter with only post_map config', async () => {
    vi.stubEnv('HEXO_POST_MAP_AMAP_KEY', 'test-key');
    vi.stubEnv('HEXO_POST_MAP_AMAP_SERVICE_HOST', undefined);
    vi.stubEnv('HEXO_POST_MAP_AMAP_SECURITY_JS_CODE', 'test-code');
    const hexo = new Hexo('/tmp/hpm-registration-test');
    hexo.config.root = '/blog/';
    hexo.config.post_map = { enabled: true, amap: {} };
    registerPlugin(hexo);
    expect(await hexo.extend.tag.render('{% post_map %}')).toBe(postMapTag());
    const post = hexo.extend.filter.execSync('after_post_render', {
      source: 'source/_posts/a.md',
      content: '<p>Body</p>',
      map: { points: [{ id: 'a', name: 'A', longitude: 1, latitude: 2 }] },
    });
    expect(post.content).toContain('data-hpm-detail');
    // Hexo maps the public registration name to this internal execution name.
    const html = hexo.extend.filter.execSync('_after_html_render', post.content);
    expect(html).toContain('/blog/hexo-post-map/assets/post-map.js');
    expect(hexo.extend.filter.execSync('_after_html_render', '<p>Ordinary</p>')).toBe(
      '<p>Ordinary</p>',
    );
  });
});
