import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/config/resolve';
import { PostMapValidationError } from '../../src/domain/errors';
import { createPostFilter } from '../../src/hexo/post-filter';
import { postMapTag } from '../../src/hexo/tag';

const onePoint = {
  points: [{ id: 'shanghai', name: '上海', longitude: 121.4737, latitude: 31.2304 }],
};
const source = 'source/_posts/a.md';
const body = '<p>Body</p>';
function config(post: Record<string, unknown> = {}) {
  return resolveConfig(
    { enabled: true, post, amap: { key: 'key', security: { security_js_code: 'code' } } },
    {},
  );
}

describe('post filter', () => {
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
