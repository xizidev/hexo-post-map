// @vitest-environment happy-dom
import { Window as HappyWindow } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BROWSER_RUNTIME_KEY,
  PENDING_HYDRATORS_KEY,
  registerRuntimeHydrator,
} from '../../src/browser/runtime/bridge';
import { createBrowserRuntime, installBrowserRuntime } from '../../src/browser/runtime/runtime';
import type { FeatureId, RuntimeHydrator } from '../../src/browser/runtime/types';

const WARNING = 'HexoPostMap: a runtime operation failed.';
const API_WARNING = 'HexoPostMap: the manual API could not be exposed.';
const SECRET = 'https://assets.test/maps/?amap=secret-key private article text';
const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
});

function runtimeHarness(
  options: {
    mutationObserver?: typeof MutationObserver | null;
    start?: boolean;
    register?: boolean;
    ready?: boolean;
    loading?: boolean;
    conflict?: boolean;
  } = {},
) {
  const window = new HappyWindow({ url: 'https://example.test/blog/post/' });
  const page = window as unknown as Window;
  const document = window.document as unknown as Document;
  Object.defineProperty(document, 'readyState', {
    configurable: true,
    value: options.loading ? 'loading' : 'complete',
  });
  if (options.conflict) Object.defineProperty(page, 'HexoPostMap', { value: 'other owner' });
  const warn = vi.spyOn(window.console, 'warn').mockImplementation(() => {});
  const controllers: { destroy: ReturnType<typeof vi.fn>; isCurrent: ReturnType<typeof vi.fn> }[] =
    [];
  const mount = vi.fn((root: HTMLElement) => {
    const canvas = root.querySelector('[data-hpm-canvas]');
    const data = root.querySelector('[data-hpm-config]');
    const controller = {
      destroy: vi.fn(),
      isCurrent: vi.fn(
        () =>
          root.querySelector('[data-hpm-canvas]') === canvas &&
          root.querySelector('[data-hpm-config]') === data,
      ),
    };
    controllers.push(controller);
    return controller;
  });
  const hydrator: RuntimeHydrator = { id: 'detail', selector: '[data-hpm-detail]', mount };
  let ready = options.ready ?? true;
  const resources = {
    ensure: vi.fn<(feature: FeatureId, retry?: boolean) => Promise<boolean>>(() =>
      Promise.resolve(ready),
    ),
    isReady: vi.fn(() => ready),
    stop: vi.fn(),
  };
  const runtime = createBrowserRuntime({
    page,
    document,
    assetBase: new URL('https://assets.test/maps/?amap=secret-key'),
    mutationObserver:
      options.mutationObserver === undefined
        ? (window.MutationObserver as unknown as typeof MutationObserver)
        : options.mutationObserver,
    resources,
  });
  Object.defineProperty(page, BROWSER_RUNTIME_KEY, { value: runtime });
  if (options.register !== false) runtime.register(hydrator);
  if (options.start !== false) runtime.start();
  const pageTransition = (type: string, persisted: boolean) => {
    const event = new window.Event(type);
    Object.defineProperty(event, 'persisted', { value: persisted });
    window.dispatchEvent(event);
  };
  cleanups.push(() => pageTransition('pagehide', false));
  return {
    window,
    page,
    document,
    runtime,
    api: runtime.api,
    mount,
    controllers,
    hydrator,
    resources,
    warn,
    setReady: (value: boolean) => {
      ready = value;
    },
    detailRoot: () => {
      const root = document.createElement('section');
      root.setAttribute('data-hpm-detail', '');
      root.innerHTML =
        '<div data-hpm-canvas></div><script data-hpm-config type="application/json">private article text</script><p data-hpm-status></p>';
      return root;
    },
    pageTransition,
    flush: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
  };
}

function expectRedacted(warn: ReturnType<typeof vi.spyOn>, message = WARNING) {
  expect(warn).toHaveBeenCalled();
  for (const args of warn.mock.calls) {
    expect(args).toEqual([message]);
    expect(String(args[0])).not.toMatch(/https:|secret-key|amap|private article text/);
  }
}

describe('browser runtime', () => {
  it('exposes one frozen versioned API and rejects invalid or foreign scopes', () => {
    const h = runtimeHarness();
    const descriptor = Object.getOwnPropertyDescriptor(h.window, 'HexoPostMap')!;
    expect(h.api.apiVersion).toBe(1);
    expect(Object.isFrozen(h.api)).toBe(true);
    expect(descriptor).toMatchObject({ enumerable: false, writable: false, configurable: false });
    expect(() => h.api.refresh({} as Element)).toThrow(TypeError);
    expect(() => h.api.destroy(new HappyWindow().document.body as unknown as Element)).toThrow(
      TypeError,
    );
    expect(() => h.api.refresh(null as unknown as Element)).toThrow(TypeError);
    expect(() => h.api.refresh(h.document.createTextNode('x') as unknown as Element)).toThrow(
      TypeError,
    );
  });

  it('creates an inert instance and starts only once after ownership is established', async () => {
    const h = runtimeHarness({ start: false });
    h.document.body.append(h.detailRoot());
    await h.flush();
    expect(h.mount).not.toHaveBeenCalled();
    expect(h.resources.ensure).not.toHaveBeenCalled();
    expect(Object.hasOwn(h.page, 'HexoPostMap')).toBe(false);
    h.runtime.start();
    h.runtime.start();
    expect(h.mount).toHaveBeenCalledTimes(1);
  });

  it('mounts once, preserves a moved root, and remounts replaced required markup', async () => {
    const h = runtimeHarness();
    const root = h.detailRoot();
    h.document.body.append(root);
    await h.flush();
    expect(h.mount).toHaveBeenCalledTimes(1);
    const holder = h.document.createElement('div');
    h.document.body.append(holder);
    holder.append(root);
    await h.flush();
    expect(h.mount).toHaveBeenCalledTimes(1);
    expect(h.controllers[0]!.destroy).not.toHaveBeenCalled();
    root.querySelector('[data-hpm-canvas]')!.replaceWith(h.document.createElement('div'));
    await h.flush();
    expect(h.controllers[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(h.mount).toHaveBeenCalledTimes(2);
  });

  it('supports scoped refresh and destroy without duplicate mounts', () => {
    const h = runtimeHarness({ mutationObserver: null });
    const inside = h.detailRoot();
    const outside = h.detailRoot();
    const scope = h.document.createDocumentFragment();
    scope.append(inside);
    h.api.refresh(scope);
    expect(h.mount).not.toHaveBeenCalled();
    h.document.body.append(scope, outside);
    h.api.refresh(inside);
    h.api.refresh(inside);
    expect(h.mount).toHaveBeenCalledTimes(1);
    h.api.destroy(inside);
    expect(h.controllers[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(h.mount).toHaveBeenCalledTimes(1);
    h.api.refresh(inside);
    expect(h.mount).toHaveBeenCalledTimes(2);
    expect(h.mount.mock.calls.every(([root]) => root === inside)).toBe(true);
  });

  it('preserves BFCache state and stops permanently on ordinary pagehide', async () => {
    const h = runtimeHarness();
    h.document.body.append(h.detailRoot());
    await h.flush();
    h.pageTransition('pagehide', true);
    h.pageTransition('pageshow', true);
    expect(h.controllers[0]!.destroy).not.toHaveBeenCalled();
    h.pageTransition('pagehide', false);
    expect(h.controllers[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(h.resources.stop).toHaveBeenCalledTimes(1);
    h.document.body.append(h.detailRoot());
    h.api.refresh();
    h.runtime.start();
    await h.flush();
    expect(h.mount).toHaveBeenCalledTimes(1);
  });

  it('does not remount a synchronously destroyed controller when its earlier ensure settles', async () => {
    const h = runtimeHarness({ mutationObserver: null });
    const root = h.detailRoot();
    h.document.body.append(root);
    h.api.refresh(root);
    h.api.destroy(root);
    await h.flush();
    expect(h.mount).toHaveBeenCalledTimes(1);
    expect(h.controllers[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-hpm-status]')!.textContent).toBe('');
  });

  it('waits for DOM readiness and handles later feature registration', () => {
    const h = runtimeHarness({ loading: true, register: false });
    h.document.body.append(h.detailRoot());
    expect(h.resources.ensure).not.toHaveBeenCalled();
    h.document.dispatchEvent(new h.window.Event('DOMContentLoaded') as unknown as Event);
    expect(h.mount).not.toHaveBeenCalled();
    registerRuntimeHydrator(h.hydrator, h.page);
    expect(h.mount).toHaveBeenCalledTimes(1);
  });

  it('invalidates earlier pending hydration when a later mounted controller is destroyed', async () => {
    const h = runtimeHarness({ ready: false, mutationObserver: null });
    let resolve!: (ready: boolean) => void;
    h.resources.ensure.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const root = h.detailRoot();
    h.document.body.append(root);
    h.api.refresh(root);
    h.setReady(true);
    h.api.refresh(root);
    h.api.destroy(root);
    resolve(true);
    await h.flush();
    expect(h.mount).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-hpm-status]')!.textContent).toBe('');
  });

  it('keeps the first hydrator for a repeated feature identifier', async () => {
    const h = runtimeHarness();
    const duplicate = vi.fn();
    registerRuntimeHydrator({ ...h.hydrator, mount: duplicate }, h.page);
    h.document.body.append(h.detailRoot());
    await h.flush();
    expect(h.mount).toHaveBeenCalledTimes(1);
    expect(duplicate).not.toHaveBeenCalled();
  });

  it('cancels first pending hydration on destroy and allows a later explicit refresh', async () => {
    const h = runtimeHarness({ ready: false, mutationObserver: null });
    let resolve!: (ready: boolean) => void;
    h.resources.ensure.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const root = h.detailRoot();
    h.document.body.append(root);
    h.api.refresh(root);
    expect(h.controllers).toHaveLength(0);
    h.api.destroy(root);
    expect(h.resources.ensure).toHaveBeenCalledTimes(1);
    h.setReady(true);
    resolve(true);
    await h.flush();
    expect(h.mount).not.toHaveBeenCalled();
    expect(root.querySelector('[data-hpm-status]')!.textContent).toBe('');
    h.api.refresh(root);
    expect(h.mount).toHaveBeenCalledTimes(1);
    expect(h.mount.mock.calls[0]![0]).toBe(root);
  });

  it('cancels only pending roots inside the destroyed scope without retrying resources', async () => {
    const h = runtimeHarness({ ready: false, mutationObserver: null });
    let resolve!: (ready: boolean) => void;
    h.resources.ensure.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const scope = h.document.createElement('article');
    const inside = h.detailRoot();
    const outside = h.detailRoot();
    scope.append(inside);
    h.document.body.append(scope, outside);
    h.api.refresh();
    h.api.destroy(scope);
    expect(h.resources.ensure).toHaveBeenCalledTimes(1);
    h.setReady(true);
    resolve(true);
    await h.flush();
    expect(h.mount).toHaveBeenCalledTimes(1);
    expect(h.mount.mock.calls[0]![0]).toBe(outside);
    h.api.refresh(inside);
    expect(h.mount).toHaveBeenCalledTimes(2);
    expect(h.mount.mock.calls[1]![0]).toBe(inside);
  });

  it('destroys removed roots and mounts replacements', async () => {
    const h = runtimeHarness();
    const root = h.detailRoot();
    h.document.body.append(root);
    await h.flush();
    const replacement = h.detailRoot();
    root.replaceWith(replacement);
    await h.flush();
    expect(h.controllers[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(h.mount).toHaveBeenLastCalledWith(replacement);
    replacement.remove();
    await h.flush();
    expect(h.controllers[1]!.destroy).toHaveBeenCalledTimes(1);
  });

  it('remounts when the embedded configuration node changes', async () => {
    const h = runtimeHarness();
    const root = h.detailRoot();
    h.document.body.append(root);
    await h.flush();
    root.querySelector('[data-hpm-config]')!.replaceWith(h.document.createElement('script'));
    await h.flush();
    expect(h.controllers[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(h.mount).toHaveBeenCalledTimes(2);
  });

  it('queues one reconciliation per mutation burst and observes only structural changes', async () => {
    let notify!: MutationCallback;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class Observer {
      constructor(callback: MutationCallback) {
        notify = callback;
      }
      observe = observe;
      disconnect = disconnect;
    }
    const h = runtimeHarness({ mutationObserver: Observer as unknown as typeof MutationObserver });
    expect(observe).toHaveBeenCalledWith(h.document, { childList: true, subtree: true });
    const root = h.detailRoot();
    h.document.body.append(root);
    h.api.refresh(root);
    h.controllers[0]!.isCurrent.mockClear();
    const records = [{ target: root, addedNodes: [] }] as unknown as MutationRecord[];
    notify(records, {} as MutationObserver);
    notify(records, {} as MutationObserver);
    notify(records, {} as MutationObserver);
    await Promise.resolve();
    expect(h.controllers[0]!.isCurrent).toHaveBeenCalledTimes(1);
    h.pageTransition('pagehide', false);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('falls back to initial and manual refresh without MutationObserver', () => {
    const h = runtimeHarness({ mutationObserver: null, start: false });
    h.document.body.append(h.detailRoot());
    h.runtime.start();
    expect(h.mount).toHaveBeenCalledTimes(1);
    h.document.body.append(h.detailRoot());
    h.api.refresh();
    expect(h.mount).toHaveBeenCalledTimes(2);
  });

  it('shows feature-specific load failure text and retries only scoped features explicitly', async () => {
    const h = runtimeHarness({ ready: false, mutationObserver: null });
    const detail = h.detailRoot();
    const overview = h.document.createElement('section');
    overview.setAttribute('data-hpm-overview', '');
    overview.innerHTML = '<p data-hpm-status></p>';
    h.document.body.append(detail, overview);
    h.api.refresh();
    await h.flush();
    expect(detail.querySelector('[data-hpm-status]')!.textContent).toBe(
      '地图暂时无法加载，请使用下方地点链接。',
    );
    expect(overview.querySelector('[data-hpm-status]')!.textContent).toBe(
      '地图暂时无法加载，请使用下方文章列表。',
    );
    h.resources.ensure.mockClear();
    h.api.destroy();
    expect(h.resources.ensure).not.toHaveBeenCalled();
    h.setReady(true);
    h.api.refresh(detail);
    expect(h.resources.ensure.mock.calls).toEqual([['detail', true]]);
    expect(h.mount).toHaveBeenCalledTimes(1);
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('uses automatic loading without explicit retry and mounts after asynchronous readiness', async () => {
    const h = runtimeHarness({ ready: false });
    let resolve!: (ready: boolean) => void;
    h.resources.ensure.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    h.document.body.append(h.detailRoot());
    await h.flush();
    expect(h.resources.ensure).toHaveBeenCalledWith('detail', false);
    expect(h.mount).not.toHaveBeenCalled();
    h.setReady(true);
    resolve(true);
    await h.flush();
    expect(h.mount).toHaveBeenCalledTimes(1);
  });

  it.each(['mount', 'currentness', 'destroy'] as const)(
    'isolates %s exceptions across roots with redacted diagnostics',
    (operation) => {
      const h = runtimeHarness({ mutationObserver: null });
      const first = h.detailRoot();
      const second = h.detailRoot();
      h.document.body.append(first, second);
      if (operation === 'mount')
        h.mount.mockImplementationOnce(() => {
          throw new Error(SECRET);
        });
      h.api.refresh();
      if (operation === 'currentness') {
        h.controllers[0]!.isCurrent.mockImplementationOnce(() => {
          throw new Error(SECRET);
        });
        h.api.refresh();
        expect(h.controllers[0]!.destroy).toHaveBeenCalledTimes(1);
      }
      if (operation === 'destroy') {
        h.controllers[0]!.destroy.mockImplementationOnce(() => {
          throw new Error(SECRET);
        });
        h.api.destroy();
        expect(h.controllers[1]!.destroy).toHaveBeenCalledTimes(1);
      }
      expect(h.mount).toHaveBeenCalledWith(second);
      expectRedacted(h.warn);
    },
  );

  it.each(['throw', 'reject', 'isReady'] as const)(
    'isolates resource %s failures between features',
    async (failure) => {
      const h = runtimeHarness({ mutationObserver: null });
      h.runtime.register({ id: 'overview', selector: '[data-hpm-overview]', mount: h.mount });
      const overview = h.detailRoot();
      overview.removeAttribute('data-hpm-detail');
      overview.setAttribute('data-hpm-overview', '');
      h.document.body.append(h.detailRoot(), overview);
      if (failure === 'isReady')
        h.resources.isReady.mockImplementationOnce(() => {
          throw new Error(SECRET);
        });
      else
        h.resources.ensure.mockImplementation((feature) => {
          if (feature !== 'detail') return Promise.resolve(true);
          if (failure === 'throw') throw new Error(SECRET);
          return Promise.reject(new Error(SECRET));
        });
      h.api.refresh();
      await h.flush();
      expect(h.mount).toHaveBeenCalledWith(overview);
      expectRedacted(h.warn);
    },
  );

  it('ignores resource completion and DOM readiness after ordinary pagehide', async () => {
    const h = runtimeHarness({ ready: false, mutationObserver: null });
    let resolve!: (ready: boolean) => void;
    h.resources.ensure.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const root = h.detailRoot();
    h.document.body.append(root);
    h.api.refresh();
    h.pageTransition('pagehide', false);
    h.setReady(true);
    resolve(true);
    h.document.dispatchEvent(new h.window.Event('DOMContentLoaded') as unknown as Event);
    await h.flush();
    expect(h.mount).not.toHaveBeenCalled();
    expect(root.querySelector('[data-hpm-status]')!.textContent).toBe('');
  });

  it('preserves a conflicting global while auto-mounting and warns only once', async () => {
    const h = runtimeHarness({ conflict: true });
    h.runtime.start();
    h.document.body.append(h.detailRoot());
    await h.flush();
    expect(Reflect.get(h.page, 'HexoPostMap')).toBe('other owner');
    expect(h.mount).toHaveBeenCalledTimes(1);
    expect(h.warn).toHaveBeenCalledTimes(1);
    expectRedacted(h.warn, API_WARNING);
  });

  it('drains pre-bootstrap hydrators exactly once and reuses duplicate installation', async () => {
    const window = new HappyWindow({ url: 'https://example.test/blog/post/' });
    const page = window as unknown as Window;
    const document = window.document as unknown as Document;
    Object.defineProperty(document, 'readyState', { value: 'complete' });
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'https://example.test/blog/hexo-post-map/assets/style.css';
    const sheet = new window.CSSStyleSheet();
    sheet.replaceSync(':root { --hpm-style-ready: 1; }');
    Object.defineProperty(style, 'sheet', { value: sheet });
    document.head.append(style);
    const script = document.createElement('script');
    script.src = 'https://example.test/blog/hexo-post-map/assets/runtime.js?v=4#hash';
    const root = document.createElement('section');
    root.setAttribute('data-hpm-detail', '');
    document.body.append(root);
    const mount = vi.fn(() => {
      expect(Reflect.get(page, BROWSER_RUNTIME_KEY)).toBeDefined();
      expect(
        (Reflect.get(page, PENDING_HYDRATORS_KEY) as Map<FeatureId, RuntimeHydrator>).size,
      ).toBe(0);
      return { destroy: vi.fn(), isCurrent: () => true };
    });
    const hydrator: RuntimeHydrator = { id: 'detail', selector: '[data-hpm-detail]', mount };
    const duplicate = vi.fn();
    registerRuntimeHydrator(hydrator, page);
    registerRuntimeHydrator({ ...hydrator, mount: duplicate }, page);
    expect(mount).not.toHaveBeenCalled();
    const first = installBrowserRuntime(script);
    const second = installBrowserRuntime(script);
    await Promise.resolve();
    expect(first).toBe(second);
    expect(Reflect.get(page, 'HexoPostMap')).toBe(first.api);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(duplicate).not.toHaveBeenCalled();
    expect(document.querySelectorAll('link')).toHaveLength(1);
    expect(document.querySelectorAll('script[src]')).toHaveLength(0);
    const event = new window.Event('pagehide');
    Object.defineProperty(event, 'persisted', { value: false });
    window.dispatchEvent(event);
  });
});
