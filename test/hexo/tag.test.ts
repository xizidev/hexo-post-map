import Hexo from 'hexo';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPlugin } from '../../src/hexo/register';
import { postMapTag } from '../../src/hexo/tag';

afterEach(() => vi.unstubAllEnvs());

describe('tag and registration', () => {
  it('defers configuration errors to generation so Hexo cannot swallow invalid builds during plugin loading', async () => {
    vi.stubEnv('HEXO_POST_MAP_AMAP_KEY', undefined);
    vi.stubEnv('HEXO_POST_MAP_AMAP_SERVICE_HOST', undefined);
    vi.stubEnv('HEXO_POST_MAP_AMAP_SECURITY_JS_CODE', undefined);
    const hexo = new Hexo('/tmp/hpm-invalid-registration-test');
    hexo.config.post_map = {
      enabled: true,
      amap: {
        key: 'private-key',
        security: { security_js_code: 'private-code', service_host: 'https://proxy.example.test' },
      },
    };
    expect(() => registerPlugin(hexo)).not.toThrow();
    const generation = hexo.extend.filter.exec('before_generate', undefined);
    await expect(generation).rejects.toMatchObject({
      name: 'ConfigValidationError',
      fieldPath: 'amap.security',
    });
    await expect(generation).rejects.not.toThrow('private-key');
    await expect(generation).rejects.not.toThrow('private-code');
    expect(hexo.extend.tag.env.hasExtension('post_map')).toBe(false);
    expect(hexo.extend.generator.get('post-map')).toBeUndefined();
  });
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
