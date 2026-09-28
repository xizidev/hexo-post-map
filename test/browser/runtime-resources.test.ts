// @vitest-environment happy-dom
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { createFeatureResourceLoader } from '../../src/browser/runtime/resources';
import type { FeatureId } from '../../src/browser/runtime/types';

function resourceHarness(
  options: { existingStyle?: 'loaded'; existingDetailScript?: boolean; assetBase?: string } = {},
) {
  const window = new Window({ url: 'https://example.test/blog/post/' });
  const document = window.document as unknown as Document;
  const hydrators = new Set<FeatureId>();
  const createdLinks: HTMLLinkElement[] = [];
  const createdScripts: HTMLScriptElement[] = [];
  let syntheticDispatch = false;
  const createElement = document.createElement.bind(document);
  Object.defineProperty(document, 'createElement', {
    value: (name: string) => {
      const element = createElement(name);
      if (name === 'link' || name === 'script') {
        // Happy DOM reports disabled external loading on append. These tests drive the
        // browser's load/error events explicitly, without a network request.
        element.addEventListener('error', (event) => {
          if (!syntheticDispatch) event.stopImmediatePropagation();
        });
        if (name === 'link') createdLinks.push(element as HTMLLinkElement);
        else createdScripts.push(element as HTMLScriptElement);
      }
      return element;
    },
  });
  const assetBase = new URL(options.assetBase ?? 'https://example.test/blog/hexo-post-map/assets/');
  if (options.existingStyle) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://example.test/blog/hexo-post-map/assets/style.css';
    Object.defineProperty(link, 'sheet', { value: {} as CSSStyleSheet });
    document.head.append(link);
  }
  if (options.existingDetailScript) {
    const script = document.createElement('script');
    script.src = 'https://example.test/blog/hexo-post-map/assets/post-map.js';
    document.body.append(script);
    hydrators.add('detail');
  }
  const loader = createFeatureResourceLoader({
    document,
    assetBase,
    hasHydrator: (feature) => hydrators.has(feature),
  });
  return {
    window,
    document,
    hydrators,
    loader,
    links: () => createdLinks,
    scripts: () => createdScripts,
    dispatch: (element: Element, type: 'load' | 'error') => {
      syntheticDispatch = true;
      try {
        element.dispatchEvent(new window.Event(type) as unknown as Event);
      } finally {
        syntheticDispatch = false;
      }
    },
  };
}

describe('feature resource loader', () => {
  it('shares one stylesheet and one detail script across concurrent roots', async () => {
    const h = resourceHarness();
    const first = h.loader.ensure('detail');
    const second = h.loader.ensure('detail');
    expect(h.links().map((node) => node.href)).toEqual([
      'https://example.test/blog/hexo-post-map/assets/style.css',
    ]);
    expect(h.scripts().map((node) => node.src)).toEqual([
      'https://example.test/blog/hexo-post-map/assets/post-map.js',
    ]);
    h.hydrators.add('detail');
    h.dispatch(h.links()[0]!, 'load');
    h.dispatch(h.scripts()[0]!, 'load');
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(h.loader.isReady('detail')).toBe(true);
  });

  it('adopts an already loaded stylesheet and registered feature script', async () => {
    const h = resourceHarness({ existingStyle: 'loaded', existingDetailScript: true });
    await expect(h.loader.ensure('detail')).resolves.toBe(true);
    expect(h.links()).toHaveLength(1);
    expect(h.scripts()).toHaveLength(1);
  });

  it('suppresses automatic retries and retries only the failed shared resource explicitly', async () => {
    const h = resourceHarness();
    const detail = h.loader.ensure('detail');
    h.hydrators.add('detail');
    h.dispatch(h.scripts()[0]!, 'load');
    h.dispatch(h.links()[0]!, 'error');
    await expect(detail).resolves.toBe(false);
    await expect(h.loader.ensure('detail')).resolves.toBe(false);
    expect(h.links()).toHaveLength(1);
    const retry = h.loader.ensure('detail', true);
    expect(h.links()).toHaveLength(2);
    expect(h.links()[0]!.isConnected).toBe(false);
    expect(h.links()[1]!.isConnected).toBe(true);
    expect(h.document.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1);
    expect(h.scripts()).toHaveLength(1);
    h.dispatch(h.links()[1]!, 'load');
    await expect(retry).resolves.toBe(true);
  });

  it('stops late load events from making a departing page ready', async () => {
    const h = resourceHarness();
    const pending = h.loader.ensure('overview');
    h.loader.stop();
    await expect(pending).resolves.toBe(false);
    h.hydrators.add('overview');
    h.dispatch(h.links()[0]!, 'load');
    h.dispatch(h.scripts()[0]!, 'load');
    expect(h.loader.isReady('overview')).toBe(false);
    await expect(h.loader.ensure('overview', true)).resolves.toBe(false);
  });

  it('keeps detail and overview script failures independent', async () => {
    const h = resourceHarness();
    const detail = h.loader.ensure('detail');
    const overview = h.loader.ensure('overview');
    expect(h.links()).toHaveLength(1);
    expect(h.scripts().map((node) => node.src)).toEqual([
      'https://example.test/blog/hexo-post-map/assets/post-map.js',
      'https://example.test/blog/hexo-post-map/assets/overview-map.js',
    ]);
    h.dispatch(h.links()[0]!, 'load');
    h.dispatch(h.scripts()[0]!, 'error');
    h.hydrators.add('overview');
    h.dispatch(h.scripts()[1]!, 'load');
    await expect(detail).resolves.toBe(false);
    await expect(overview).resolves.toBe(true);
    expect(h.loader.isReady('detail')).toBe(false);
    expect(h.loader.isReady('overview')).toBe(true);
    await expect(h.loader.ensure('detail')).resolves.toBe(false);
    expect(h.scripts()).toHaveLength(2);
  });

  it('derives query- and hash-free canonical resource URLs from the asset base', async () => {
    const h = resourceHarness({
      assetBase: 'https://example.test/blog/hexo-post-map/assets/?page=old#section',
    });
    const pending = h.loader.ensure('overview');
    expect(h.links()[0]!.href).toBe('https://example.test/blog/hexo-post-map/assets/style.css');
    expect(h.scripts()[0]!.src).toBe(
      'https://example.test/blog/hexo-post-map/assets/overview-map.js',
    );
    h.hydrators.add('overview');
    h.dispatch(h.links()[0]!, 'load');
    h.dispatch(h.scripts()[0]!, 'load');
    await expect(pending).resolves.toBe(true);
  });

  it('reuses a successful detail script when overview explicitly retries shared style', async () => {
    const h = resourceHarness();
    const detail = h.loader.ensure('detail');
    h.hydrators.add('detail');
    h.dispatch(h.scripts()[0]!, 'load');
    h.dispatch(h.links()[0]!, 'error');
    await expect(detail).resolves.toBe(false);

    const overview = h.loader.ensure('overview', true);
    expect(h.links()).toHaveLength(2);
    expect(h.links()[0]!.isConnected).toBe(false);
    expect(h.links()[1]!.isConnected).toBe(true);
    expect(h.document.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1);
    expect(h.scripts()).toHaveLength(2);
    h.hydrators.add('overview');
    h.dispatch(h.scripts()[1]!, 'load');
    h.dispatch(h.links()[1]!, 'load');
    await expect(overview).resolves.toBe(true);
    await expect(h.loader.ensure('detail')).resolves.toBe(true);
    expect(h.scripts()).toHaveLength(2);
  });
});
