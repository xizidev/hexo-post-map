import { describe, expect, it } from 'vitest';
import { injectMarkedAssets } from '../../src/hexo/injector';

describe('selective asset injection', () => {
  it.each([
    '<p>Ordinary</p>',
    '<!-- data-hpm-detail -->',
    '<script>"<section data-hpm-detail>"</script>',
    '<p>data-hpm-overview</p>',
    '<div data-note="data-hpm-detail"></div>',
  ])('leaves non-map HTML unchanged: %s', (html) => {
    expect(injectMarkedAssets(html, '/')).toBe(html);
  });
  it.each([
    ['data-hpm-detail', 'post-map.js', 'overview-map.js'],
    ['data-hpm-overview', 'overview-map.js', 'post-map.js'],
  ])('loads only assets for %s', (marker, wanted, absent) => {
    const html = injectMarkedAssets(
      `<html><head><title>T</title></head><body><section ${marker}></section></body></html>`,
      '/blog/',
    );
    expect(html).toContain(
      '<link rel="stylesheet" href="/blog/hexo-post-map/assets/style.css"></head>',
    );
    expect(html).toContain(
      `<script defer src="/blog/hexo-post-map/assets/${wanted}"></script></body>`,
    );
    expect(html).not.toContain(absent);
    expect(injectMarkedAssets(html, '/blog/')).toBe(html);
  });
  it('injects each required asset once when both map types are present', () => {
    const html = injectMarkedAssets(
      '<section data-hpm-detail></section><section data-hpm-overview></section>',
      '/',
    );
    expect(html.match(/style\.css/g)).toHaveLength(1);
    expect(html.match(/post-map\.js/g)).toHaveLength(1);
    expect(html.match(/overview-map\.js/g)).toHaveLength(1);
  });
  it.each([
    '<SECTION DATA-HPM-DETAIL></SECTION>',
    '<HTML><HEAD></HEAD><BODY class="main"><section data-hpm-detail></section></BODY ></HTML>',
    '<html><body><section data-hpm-detail></section></html>',
    '<section data-hpm-detail></section>',
  ])('supports fragment, uppercase and omitted closing body: %s', (input) => {
    const html = injectMarkedAssets(input, '/blog');
    expect(html).toContain('/blog/hexo-post-map/assets/style.css');
    expect(html).toContain('/blog/hexo-post-map/assets/post-map.js');
    expect(injectMarkedAssets(html, '/blog')).toBe(html);
  });
  it('recognizes preexisting assets regardless of quoting and attribute order', () => {
    const input =
      "<link href='/hexo-post-map/assets/style.css' rel='stylesheet'><section data-hpm-detail></section><script src='/hexo-post-map/assets/post-map.js' defer></script>";
    expect(injectMarkedAssets(input, '/')).toBe(input);
  });
  it('does not confuse asset names in article text with existing assets', () => {
    const html = injectMarkedAssets(
      '<p>/hexo-post-map/assets/post-map.js</p><section data-hpm-detail></section>',
      '/',
    );
    expect(html).toContain('<script defer src="/hexo-post-map/assets/post-map.js"></script>');
  });
  it('preserves a leading doctype when the document omits its head', () => {
    const html = injectMarkedAssets(
      '<!doctype html><html><body><section data-hpm-detail></section></body></html>',
      '/',
    );
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<body><link rel="stylesheet"');
  });
  it.each(['/blog/?q=x', '/blog/#section', 'javascript:bad', '//evil.test/'])(
    'rejects unsafe asset roots %s',
    (root) => {
      expect(() => injectMarkedAssets('<section data-hpm-detail></section>', root)).toThrow(/root/);
    },
  );
});
