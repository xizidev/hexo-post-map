import { describe, expect, it } from 'vitest';
import { createPostIndex } from '../../src/browser/overview/post-index';
import { createOverviewShare, readOverviewShare } from '../../src/browser/overview/share';

const a = {
  title: 'A',
  url: '/blog/上海%2F外滩/',
  date: '2026-01-01',
  image: '/secret-image.jpg',
  location: { name: 'A', longitude: 121, latitude: 31 },
};
const context = {
  origin: 'http://127.0.0.1:4000',
  overviewUrl: '/blog/map/',
  maxZoom: 18,
  index: createPostIndex([a]),
};
const view = { center: [121.491234567, 31.241234567] as const, zoom: 11.123 };
const query = '?hpm_v=1&hpm_center=121,31&hpm_zoom=11';
const href = `http://127.0.0.1:4000/blog/map/${query}`;
describe('overview share codec', () => {
  it('shares only public plugin parameters at the current origin', () => {
    const link = createOverviewShare(
      view,
      { mode: 'single', urls: [a.url], scroll: { top: 800 } },
      context,
    )!;
    const url = new URL(link);
    expect(url.origin).toBe('http://127.0.0.1:4000');
    expect(url.pathname).toBe('/blog/map/');
    expect(url.searchParams.get('hpm_center')).toBe('121.491235,31.241235');
    expect(url.searchParams.get('hpm_zoom')).toBe('11.12');
    expect(url.searchParams.get('hpm_post')).toBe('/blog/上海%2F外滩/');
    expect([...url.searchParams.keys()]).toEqual(['hpm_v', 'hpm_center', 'hpm_zoom', 'hpm_post']);
    expect(url.hash).toBe('');
    expect(readOverviewShare(link, context)).toEqual({
      view: { center: [121.491235, 31.241235], zoom: 11.12 },
      postUrl: a.url,
    });
  });
  it.each([
    '&hpm_v=1',
    '&hpm_center=1,2',
    '&hpm_zoom=3',
    '&hpm_post=/a/&hpm_post=/b/',
    '&hpm_unknown=1',
  ])('rejects duplicate or unknown hpm keys: %s', (extra) => {
    expect(readOverviewShare(href + extra, context)).toBeUndefined();
  });
  it.each(['0', '2', '01', '', '1.0'])('rejects invalid version %s', (version) => {
    expect(readOverviewShare(href.replace('hpm_v=1', `hpm_v=${version}`), context)).toBeUndefined();
  });
  it('rejects oversized input before URL parsing', () => {
    expect(readOverviewShare(href + '&theme=' + 'x'.repeat(4096), context)).toBeUndefined();
  });
  it.each(['/blog/map/', '/blog/map/index.html'])('accepts literal map route %s', (path) => {
    expect(readOverviewShare(context.origin + path + query, context)?.view).toEqual({
      center: [121, 31],
      zoom: 11,
    });
  });
  it.each([
    '/blog/map',
    '/blog/map/index.HTML',
    '/blog/map/%69ndex.html',
    '/blog/map%2F',
    '/blog/map/index.html/child',
    '/other/',
  ])('rejects nonliteral map route %s', (path) => {
    expect(readOverviewShare(context.origin + path + query, context)).toBeUndefined();
  });
  it('rejects foreign origins and unsafe or query-bearing configured routes', () => {
    expect(readOverviewShare(href.replace('127.0.0.1', 'localhost'), context)).toBeUndefined();
    for (const overviewUrl of [
      'javascript:alert(1)',
      '//evil.test/map/',
      '/blog/map/?key=secret',
      '/blog/map/#secret',
      'http://@127.0.0.1:4000/blog/map/',
    ]) {
      expect(
        createOverviewShare(view, { mode: 'closed' }, { ...context, overviewUrl }),
      ).toBeUndefined();
    }
  });
  it.each([
    'NaN,31',
    'Infinity,31',
    '181,31',
    '121,91',
    '121,31,2',
    '121x,31',
    ',31',
    ' 121,31',
    '0x10,31',
  ])('rejects invalid center %s', (center) => {
    expect(readOverviewShare(href.replace('121,31', center), context)).toBeUndefined();
  });
  it.each(['NaN', 'Infinity', '11px', '', '0x10', ' 11'])('rejects invalid zoom %s', (zoom) => {
    expect(
      readOverviewShare(href.replace('hpm_zoom=11', `hpm_zoom=${zoom}`), context),
    ).toBeUndefined();
  });
  it('clamps finite zoom and rejects nonfinite producer view', () => {
    expect(readOverviewShare(href.replace('hpm_zoom=11', 'hpm_zoom=99'), context)?.view.zoom).toBe(
      18,
    );
    expect(readOverviewShare(href.replace('hpm_zoom=11', 'hpm_zoom=-1'), context)?.view.zoom).toBe(
      2,
    );
    expect(
      createOverviewShare({ center: [NaN, 31], zoom: 11 }, { mode: 'closed' }, context),
    ).toBeUndefined();
    expect(
      createOverviewShare({ center: [121, 31], zoom: Infinity }, { mode: 'closed' }, context),
    ).toBeUndefined();
  });
  it('downgrades unknown ambiguous and malicious post references to view-only', () => {
    const duplicate = { ...context, index: createPostIndex([a, a]) };
    for (const ref of [
      '/unknown/',
      'javascript:alert(1)',
      'https://user:password@evil.test/a/',
      '%2Fblog%2F上海%252F外滩%2F',
    ]) {
      expect(readOverviewShare(href + '&hpm_post=' + encodeURIComponent(ref), context)).toEqual({
        view: { center: [121, 31], zoom: 11 },
      });
    }
    expect(readOverviewShare(href + '&hpm_post=' + encodeURIComponent(a.url), duplicate)).toEqual({
      view: { center: [121, 31], zoom: 11 },
    });
    expect(
      new URL(
        createOverviewShare(
          view,
          { mode: 'single', urls: [a.url], scroll: { top: 0 } },
          duplicate,
        )!,
      ).searchParams.has('hpm_post'),
    ).toBe(false);
  });
  it('drops an overlong encoded article ref to keep the link within 4096 characters', () => {
    const long = { ...a, url: '/' + '上'.repeat(1000) + '/' };
    const link = createOverviewShare(
      view,
      { mode: 'single', urls: [long.url], scroll: { top: 0 } },
      { ...context, index: createPostIndex([long]) },
    )!;
    expect(link.length).toBeLessThanOrEqual(4096);
    expect(new URL(link).searchParams.has('hpm_post')).toBe(false);
  });
  it('shares group and all as view-only and ignores unrelated theme query', () => {
    for (const panel of [
      { mode: 'all' as const, scroll: { top: 9 } },
      { mode: 'group' as const, urls: [a.url], scroll: { top: 9 } },
    ]) {
      const link = createOverviewShare(view, panel, context)!;
      expect(new URL(link).searchParams.has('hpm_post')).toBe(false);
    }
    expect(readOverviewShare(href + '&theme=secret#fragment', context)?.view.zoom).toBe(11);
  });
});
