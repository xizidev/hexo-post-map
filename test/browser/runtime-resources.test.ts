// @vitest-environment happy-dom
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { createFeatureResourceLoader } from '../../src/browser/runtime/resources';
import type { FeatureId } from '../../src/browser/runtime/types';

function resourceHarness(
  options: {
    existingStyle?: 'loaded' | 'failed';
    existingDetailScript?: boolean;
    assetBase?: string;
  } = {},
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
  const applyStylesheet = () => {
    const style = document.createElement('style');
    style.textContent = ':root { --hpm-style-ready: 1; }';
    document.head.append(style);
  };
  if (options.existingStyle) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://example.test/blog/hexo-post-map/assets/style.css';
    Object.defineProperty(link, 'sheet', { value: new window.CSSStyleSheet() });
    document.head.append(link);
    if (options.existingStyle === 'loaded') applyStylesheet();
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
    applyStylesheet,
    links: () => createdLinks,
    scripts: () => createdScripts,
    dispatch: (element: Element, type: 'load' | 'error', applied = true) => {
      syntheticDispatch = true;
      try {
        if (element.tagName === 'LINK' && type === 'load' && applied) applyStylesheet();
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

  it('settles a static stylesheet whose error passed before startup without trusting its sheet', async () => {
    const h = resourceHarness({ existingStyle: 'failed', existingDetailScript: true });
    expect(h.links()[0]!.sheet).not.toBeNull();
    const pending = h.loader.ensure('detail');
    h.window.dispatchEvent(new h.window.Event('load'));
    await expect(pending).resolves.toBe(false);
    expect(h.loader.isReady('detail')).toBe(false);
    await expect(h.loader.ensure('detail')).resolves.toBe(false);
    expect(h.links()).toHaveLength(1);

    const retry = h.loader.ensure('detail', true);
    expect(h.links()).toHaveLength(2);
    expect(h.links()[0]!.isConnected).toBe(false);
    expect(h.scripts()).toHaveLength(1);
    h.dispatch(h.links()[1]!, 'load');
    await expect(retry).resolves.toBe(true);
  });

  it('settles an unknown existing stylesheet even when the document load event already passed', async () => {
    vi.useFakeTimers();
    const h = resourceHarness({ existingStyle: 'failed', existingDetailScript: true });
    Object.defineProperty(h.document, 'readyState', { value: 'complete' });
    try {
      const pending = h.loader.ensure('detail');
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBe(false);
      expect(h.loader.isReady('detail')).toBe(false);
      expect(h.links()).toHaveLength(1);
    } finally {
      h.loader.stop();
      vi.useRealTimers();
    }
  });

  it('waits for a pending existing stylesheet after document load and adopts its applied CSS', async () => {
    const h = resourceHarness({ existingDetailScript: true });
    Object.defineProperty(h.document, 'readyState', { value: 'complete' });
    const link = h.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://example.test/blog/hexo-post-map/assets/style.css';
    h.document.head.append(link);
    const pending = h.loader.ensure('detail');
    await Promise.resolve();
    expect(h.loader.isReady('detail')).toBe(false);
    h.dispatch(link, 'load');
    await expect(pending).resolves.toBe(true);
    expect(h.links()).toHaveLength(1);
  });

  it('does not accept a stylesheet load event without the applied CSS signal', async () => {
    const h = resourceHarness({ existingDetailScript: true });
    const pending = h.loader.ensure('detail');
    h.dispatch(h.links()[0]!, 'load', false);
    await expect(pending).resolves.toBe(false);
    expect(h.loader.isReady('detail')).toBe(false);
  });

  it('prefers a loaded canonical stylesheet after an unfinished duplicate', async () => {
    const h = resourceHarness({ existingDetailScript: true });
    const first = h.document.createElement('link');
    first.rel = 'stylesheet';
    first.href = 'https://example.test/blog/hexo-post-map/assets/style.css';
    h.document.head.append(first);
    const loaded = h.document.createElement('link');
    loaded.rel = 'stylesheet';
    loaded.href = 'https://example.test/blog/hexo-post-map/assets/style.css';
    Object.defineProperty(loaded, 'sheet', { value: new h.window.CSSStyleSheet() });
    h.document.head.append(loaded);
    h.applyStylesheet();
    expect(first.sheet).toBeNull();
    expect(loaded.sheet).not.toBeNull();

    const pending = h.loader.ensure('detail');
    try {
      expect(h.loader.isReady('detail')).toBe(true);
      await expect(pending).resolves.toBe(true);
      expect(h.links()).toHaveLength(2);
      expect(h.document.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(2);
    } finally {
      h.loader.stop();
    }
  });

  it('reuses the first canonical stylesheet when duplicate links are unfinished', async () => {
    const h = resourceHarness({ existingDetailScript: true });
    for (let index = 0; index < 2; index++) {
      const link = h.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://example.test/blog/hexo-post-map/assets/style.css';
      h.document.head.append(link);
    }

    const pending = h.loader.ensure('detail');
    expect(h.links()).toHaveLength(2);
    expect(h.document.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(2);
    h.dispatch(h.links()[1]!, 'error');
    expect(h.loader.isReady('detail')).toBe(false);
    h.dispatch(h.links()[0]!, 'load');
    await expect(pending).resolves.toBe(true);
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
