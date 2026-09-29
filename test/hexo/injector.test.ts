import { describe, expect, it } from 'vitest';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { injectBrowserRuntime } from '../../src/hexo/injector';

function parsedElements(node: DefaultTreeAdapterMap['node']): DefaultTreeAdapterMap['element'][] {
  return [
    ...('tagName' in node ? [node] : []),
    ...('childNodes' in node ? node.childNodes.flatMap(parsedElements) : []),
  ];
}

function injectedScripts(html: string) {
  return parsedElements(parse(html)).filter(
    (node) =>
      node.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
      node.tagName === 'script' &&
      node.attrs.some(
        (attr) => attr.name === 'src' && attr.value === '/hexo-post-map/assets/runtime.js',
      ) &&
      !node.attrs.some((attr) => attr.name === 'type'),
  );
}

describe('browser runtime injection', () => {
  it('injects only the runtime into ordinary enabled HTML', () => {
    const html = injectBrowserRuntime(
      '<html><head></head><body><p>Plain</p></body></html>',
      '/blog/',
    );
    expect(html).toContain('<script defer src="/blog/hexo-post-map/assets/runtime.js"></script>');
    expect(html).not.toContain('style.css');
    expect(html).not.toContain('post-map.js');
    expect(html).not.toContain('overview-map.js');
    expect(injectBrowserRuntime(html, '/blog/')).toBe(html);
  });
  it.each(['data-hpm-detail', 'data-hpm-overview'])(
    'keeps one static fallback stylesheet for %s',
    (marker) => {
      const html = injectBrowserRuntime(`<section ${marker}></section>`, '/');
      expect(html.match(/runtime\.js/gu)).toHaveLength(1);
      expect(html.match(/style\.css/gu)).toHaveLength(1);
      expect(html).not.toMatch(/(?:post-map|overview-map)\.js/u);
    },
  );
  it.each([
    '<!-- unfinished',
    '<textarea>unfinished',
    '<title>unfinished',
    '<style>unfinished',
    '<script>unfinished',
    '<xmp>unfinished',
    '<iframe>unfinished',
    '<noembed>unfinished',
    '<noframes>unfinished',
    '<plaintext>unfinished',
    '<noscript>unfinished',
    '<template>unfinished',
    '<svg>unfinished',
  ])('inserts executable runtime before an unclosed tail: %s', (tail) => {
    const input = `<section data-hpm-detail></section>${tail}`;
    const html = injectBrowserRuntime(input, '/');
    expect(injectedScripts(html)).toHaveLength(1);
    expect(html.endsWith(tail)).toBe(true);
    expect(injectBrowserRuntime(html, '/')).toBe(html);
  });
  it.each(['application/json', 'importmap', 'speculationrules', 'text/plain'])(
    'does not count a %s data block as an executable bundle',
    (type) => {
      const input = `<section data-hpm-detail></section><script type="${type}" src="/hexo-post-map/assets/runtime.js"></script>`;
      const html = injectBrowserRuntime(input, '/');
      expect(injectedScripts(html)).toHaveLength(1);
      expect(injectBrowserRuntime(html, '/')).toBe(html);
    },
  );
  it('does not count a foreign-namespace script as the HTML bundle', () => {
    const html = injectBrowserRuntime(
      '<section data-hpm-detail></section><svg><script src="/hexo-post-map/assets/runtime.js"></script></svg>',
      '/',
    );
    expect(injectedScripts(html)).toHaveLength(1);
    expect(injectBrowserRuntime(html, '/')).toBe(html);
  });
  it.each([
    '',
    'module',
    ' MODULE ',
    'text/javascript',
    ' Text/JavaScript ',
    'application/javascript',
    'text/ecmascript',
    'application/x-javascript',
  ])('recognizes executable script type %j', (type) => {
    const input = `<link rel="stylesheet" href="/hexo-post-map/assets/style.css"><section data-hpm-detail></section><script type="${type}" src="/hexo-post-map/assets/runtime.js"></script>`;
    expect(injectBrowserRuntime(input, '/')).toBe(input);
  });
  it.each([
    '<link disabled rel="stylesheet" href="/hexo-post-map/assets/style.css">',
    '<svg><link rel="stylesheet" href="/hexo-post-map/assets/style.css"></link></svg>',
  ])('does not count an inactive stylesheet as loaded: %s', (link) => {
    const html = injectBrowserRuntime(`<section data-hpm-detail></section>${link}`, '/');
    const styles = parsedElements(parse(html)).filter(
      (node) =>
        node.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
        node.tagName === 'link' &&
        node.attrs.some((attr) => attr.name === 'rel' && attr.value === 'stylesheet') &&
        !node.attrs.some((attr) => attr.name === 'disabled'),
    );
    expect(styles).toHaveLength(1);
    expect(injectBrowserRuntime(html, '/')).toBe(html);
  });
  it.each([
    '<!-- data-hpm-detail -->',
    '<script>"<section data-hpm-detail>"</script>',
    '<p>data-hpm-overview</p>',
    '<div data-note="data-hpm-detail"></div>',
    '<svg data-hpm-detail></svg>',
  ])('does not infer fallback style from non-map content: %s', (input) => {
    const html = injectBrowserRuntime(input, '/');
    expect(injectedScripts(html)).toHaveLength(1);
    expect(html).not.toContain('style.css');
  });
  it('places assets at document boundaries', () => {
    const html = injectBrowserRuntime(
      '<html><head><title>T</title></head><body><section data-hpm-detail></section></body></html>',
      '/blog/',
    );
    expect(html).toContain(
      '<link rel="stylesheet" href="/blog/hexo-post-map/assets/style.css"></head>',
    );
    expect(html).toContain(
      '<script defer src="/blog/hexo-post-map/assets/runtime.js"></script></body>',
    );
    expect(html).not.toMatch(/(?:post-map|overview-map)\.js/u);
    expect(injectBrowserRuntime(html, '/blog/')).toBe(html);
  });
  it('injects runtime and fallback style once when both map types are present', () => {
    const html = injectBrowserRuntime(
      '<section data-hpm-detail></section><section data-hpm-overview></section>',
      '/',
    );
    expect(html.match(/style\.css/g)).toHaveLength(1);
    expect(html.match(/runtime\.js/g)).toHaveLength(1);
    expect(html).not.toMatch(/(?:post-map|overview-map)\.js/u);
  });
  it.each([
    '<SECTION DATA-HPM-DETAIL></SECTION>',
    '<HTML><HEAD></HEAD><BODY class="main"><section data-hpm-detail></section></BODY ></HTML>',
    '<html><body><section data-hpm-detail></section></html>',
    '<section data-hpm-detail></section>',
  ])('supports fragment, uppercase and omitted closing body: %s', (input) => {
    const html = injectBrowserRuntime(input, '/blog');
    expect(html).toContain('/blog/hexo-post-map/assets/style.css');
    expect(html).toContain('/blog/hexo-post-map/assets/runtime.js');
    expect(injectBrowserRuntime(html, '/blog')).toBe(html);
  });
  it('recognizes preexisting assets regardless of quoting and attribute order', () => {
    const input =
      "<link href='/hexo-post-map/assets/style.css' rel='stylesheet'><section data-hpm-detail></section><script src='/hexo-post-map/assets/runtime.js' defer></script>";
    expect(injectBrowserRuntime(input, '/')).toBe(input);
  });
  it('does not confuse asset names in article text with existing assets', () => {
    const html = injectBrowserRuntime(
      '<p>/hexo-post-map/assets/runtime.js</p><section data-hpm-detail></section>',
      '/',
    );
    expect(html).toContain('<script defer src="/hexo-post-map/assets/runtime.js"></script>');
  });
  it('preserves a leading doctype when the document omits its head', () => {
    const html = injectBrowserRuntime(
      '<!doctype html><html><body><section data-hpm-detail></section></body></html>',
      '/',
    );
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<body><link rel="stylesheet"');
  });
  it.each(['/blog/?q=x', '/blog/#section', 'javascript:bad', '//evil.test/'])(
    'rejects unsafe asset roots %s',
    (root) => {
      expect(() => injectBrowserRuntime('<p>Plain</p>', root)).toThrow(/root/);
    },
  );
});
