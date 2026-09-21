// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrateDetail, initializeDetailMaps } from '../../src/browser/detail/index';
import { renderDetailMap } from '../../src/templates/detail';
import { resolveConfig } from '../../src/config/resolve';
import { normalizePostMap } from '../../src/domain/normalize';
import type { DetailMapModel, MapHandle, MapProvider } from '../../src/browser/providers/types';

const config = resolveConfig(
  { enabled: true, amap: { key: 'key', security: { service_host: 'https://example.com/proxy' } } },
  {},
)!;
const map = normalizePostMap(
  { points: [{ id: 'a', name: '上海', longitude: 121, latitude: 31 }] },
  'test.md',
)!;
function fixture() {
  document.body.innerHTML = renderDetailMap({ map, config });
  return document.querySelector<HTMLElement>('[data-hpm-detail]')!;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function pageTransition(type: 'pagehide' | 'pageshow', persisted: boolean) {
  const event = new PageTransitionEvent(type, { persisted });
  // happy-dom aliases PageTransitionEvent to Event and omits the persisted property.
  Object.defineProperty(event, 'persisted', { value: persisted });
  window.dispatchEvent(event);
}
afterEach(() => {
  pageTransition('pagehide', false);
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('detail hydration', () => {
  it('keeps one usable map across repeated BFCache restores and destroys it on ordinary pagehide', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = fixture();
    const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
    const mountDetail = vi.fn<MapProvider['mountDetail']>(async () => handle);
    const load = vi.fn(async () => ({ mountDetail, mountOverview: vi.fn() }));
    const controller = hydrateDetail(root, load);
    const canvas = root.querySelector<HTMLElement>('[data-hpm-canvas]')!;
    expect(canvas.tabIndex).toBe(-1);
    await flush();
    expect(canvas.tabIndex).toBe(0);
    for (let visit = 0; visit < 2; visit++) {
      pageTransition('pagehide', true);
      expect(canvas.tabIndex).toBe(0);
      pageTransition('pageshow', true);
      pageTransition('pageshow', true);
      await flush();
      expect(root.querySelectorAll('[data-hpm-activate]')).toHaveLength(0);
      expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(true);
      expect(root.dataset.hpmActive).toBe('true');
      expect(handle.setInteractive).toHaveBeenLastCalledWith(true);
      expect(canvas.tabIndex).toBe(0);
      expect(hydrateDetail(root, load)).toBe(controller);
    }
    expect(load).toHaveBeenCalledTimes(1);
    expect(mountDetail).toHaveBeenCalledTimes(1);
    expect(handle.destroy).not.toHaveBeenCalled();
    pageTransition('pagehide', false);
    expect(canvas.tabIndex).toBe(-1);
    pageTransition('pageshow', false);
    expect(handle.destroy).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll('[data-hpm-activate]')).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('allows a pending map to finish after BFCache restore without aborting its owner', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = fixture();
    const pending = deferred<MapHandle>();
    let signal: AbortSignal | undefined;
    hydrateDetail(root, async () => ({
      mountDetail: (_container, model) => {
        signal = model.signal;
        return pending.promise;
      },
      mountOverview: vi.fn(),
    }));
    await flush();
    pageTransition('pagehide', true);
    pageTransition('pageshow', true);
    expect(signal?.aborted).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-hpm-canvas]')!.tabIndex).toBe(-1);
    const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
    pending.resolve(handle);
    await flush();
    expect(root.querySelector('[data-hpm-activate]')).toBe(null);
    expect(handle.setInteractive).toHaveBeenLastCalledWith(true);
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(true);
    expect(handle.destroy).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLElement>('[data-hpm-canvas]')!.tabIndex).toBe(0);
  });
  it('releases failed configuration registration on pagehide before explicit rebuild', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = fixture();
    const data = root.querySelector('[data-hpm-data]')!;
    const valid = data.textContent;
    data.textContent = '{';
    const load = vi.fn(async () => ({
      mountDetail: async () => ({ destroy: vi.fn(), setInteractive: vi.fn() }),
      mountOverview: vi.fn(),
    }));
    const failed = hydrateDetail(root, load);
    window.dispatchEvent(new Event('pagehide'));
    data.textContent = valid;
    const rebuilt = hydrateDetail(root, load);
    expect(rebuilt).not.toBe(failed);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    rebuilt.destroy();
  });
  it('deduplicates sections across repeated initialization and independent bundle modules', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = fixture();
    const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
    const mountDetail = vi.fn<MapProvider['mountDetail']>(async () => handle);
    const load = vi.fn(async () => ({ mountDetail, mountOverview: vi.fn() }));
    const first = hydrateDetail(root, load);
    initializeDetailMaps(document, load);
    vi.resetModules();
    const otherBundle = await import('../../src/browser/detail/index');
    otherBundle.initializeDetailMaps(document, load);
    expect(otherBundle.hydrateDetail(root, load)).toBe(first);
    await flush();
    expect(root.querySelectorAll('[data-hpm-activate]')).toHaveLength(0);
    expect(mountDetail).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    first.destroy();
  });

  it.each(['destroy', 'pagehide'])(
    'releases the section registration after %s so explicit initialization can rebuild',
    async (reason) => {
      vi.stubGlobal('IntersectionObserver', undefined);
      const root = fixture();
      const handles = Array.from({ length: 2 }, () => ({
        destroy: vi.fn(),
        setInteractive: vi.fn(),
      }));
      const mountDetail = vi
        .fn<MapProvider['mountDetail']>()
        .mockResolvedValueOnce(handles[0]!)
        .mockResolvedValueOnce(handles[1]!);
      const load = async () => ({ mountDetail, mountOverview: vi.fn() });
      const first = hydrateDetail(root, load);
      await flush();
      const canvas = root.querySelector<HTMLElement>('[data-hpm-canvas]')!;
      expect(canvas.tabIndex).toBe(0);
      if (reason === 'destroy') first.destroy();
      else window.dispatchEvent(new Event('pagehide'));
      expect(canvas.tabIndex).toBe(-1);
      expect(root.querySelectorAll('[data-hpm-activate]')).toHaveLength(0);
      const second = hydrateDetail(root, load);
      expect(second).not.toBe(first);
      await flush();
      expect(mountDetail).toHaveBeenCalledTimes(2);
      expect(root.querySelectorAll('[data-hpm-activate]')).toHaveLength(0);
      expect(handles[1]!.setInteractive).toHaveBeenLastCalledWith(true);
      expect(handles[0]!.destroy).toHaveBeenCalledTimes(1);
      expect(canvas.tabIndex).toBe(0);
      second.destroy();
      expect(canvas.tabIndex).toBe(-1);
    },
  );
  it('waits until intersection within 300px and keeps SSR links until complete', async () => {
    let intersect!: IntersectionObserverCallback;
    const disconnect = vi.fn();
    let options: IntersectionObserverInit | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback, init?: IntersectionObserverInit) {
          intersect = callback;
          options = init;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const root = fixture();
    const pending = deferred<MapHandle>();
    const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
    const mountDetail = vi.fn<MapProvider['mountDetail']>(() => pending.promise);
    const load = vi.fn(async () => ({ mountDetail, mountOverview: vi.fn() }));
    const controller = hydrateDetail(root, load);
    const canvas = root.querySelector<HTMLElement>('[data-hpm-canvas]')!;
    expect(canvas.tabIndex).toBe(-1);
    expect(load).not.toHaveBeenCalled();
    expect(options?.rootMargin).toBe('300px');
    intersect([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(load).not.toHaveBeenCalled();
    intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(canvas.tabIndex).toBe(-1);
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(root.querySelector('[data-hpm-status]')!.textContent).toBe('');
    expect(mountDetail.mock.calls[0]?.[1]).toMatchObject({ map, defaultZoom: 11 });
    pending.resolve(handle);
    await flush();
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(true);
    expect(root.querySelector('[data-hpm-status]')!.textContent).toBe('');
    expect(handle.setInteractive).toHaveBeenLastCalledWith(true);
    expect(disconnect).toHaveBeenCalled();
    expect(canvas.tabIndex).toBe(0);
    controller.destroy();
    expect(canvas.tabIndex).toBe(-1);
    expect(handle.destroy).toHaveBeenCalledTimes(1);
  });

  it('enables interaction automatically without an activation overlay or success prompt', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = fixture();
    const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
    const controller = hydrateDetail(root, async () => ({
      mountDetail: async () => handle,
      mountOverview: vi.fn(),
    }));
    await flush();
    expect(root.querySelector('[data-hpm-activate]')).toBe(null);
    expect(handle.setInteractive).toHaveBeenLastCalledWith(true);
    expect(root.dataset.hpmActive).toBe('true');
    expect(root.querySelector('[data-hpm-status]')!.textContent).toBe('');
    controller.destroy();
  });

  it.each(['load', 'mount', 'interaction', 'runtime'])(
    'retains or restores fallback on %s failure',
    async (stage) => {
      vi.stubGlobal('IntersectionObserver', undefined);
      const root = fixture();
      const handle = {
        destroy: vi.fn(),
        setInteractive: vi.fn(() => {
          if (stage === 'interaction') throw new Error('private interaction error');
        }),
      };
      let model!: DetailMapModel;
      const provider: MapProvider = {
        mountDetail: async (_container, data) => {
          model = data;
          if (stage === 'mount') throw new Error('private error');
          return handle;
        },
        mountOverview: vi.fn(),
      };
      const controller = hydrateDetail(root, async () => {
        if (stage === 'load') throw new Error('private credentials');
        return provider;
      });
      await flush();
      const canvas = root.querySelector<HTMLElement>('[data-hpm-canvas]')!;
      if (stage === 'runtime') {
        expect(canvas.tabIndex).toBe(0);
        model.onError?.();
      }
      expect(canvas.tabIndex).toBe(-1);
      expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
      expect(root.querySelector('a')!.href).toContain('uri.amap.com');
      expect(root.querySelector('[data-hpm-status]')!.textContent).toContain('暂时无法加载');
      expect(root.textContent).not.toContain('private');
      controller.destroy();
    },
  );

  it('aborts pending mounts on pagehide and destroys late handles without hiding fallback', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = fixture();
    const pending = deferred<MapHandle>();
    let signal: AbortSignal | undefined;
    const controller = hydrateDetail(root, async () => ({
      mountDetail: (_container, model) => {
        signal = model.signal;
        return pending.promise;
      },
      mountOverview: vi.fn(),
    }));
    await flush();
    window.dispatchEvent(new Event('pagehide'));
    expect(signal?.aborted).toBe(true);
    const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
    pending.resolve(handle);
    await flush();
    expect(handle.destroy).toHaveBeenCalledTimes(1);
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-hpm-canvas]')!.tabIndex).toBe(-1);
    controller.destroy();
  });

  it('handles invalid embedded JSON locally without loading a provider', async () => {
    const root = fixture();
    root.querySelector('[data-hpm-data]')!.textContent = '{';
    const load = vi.fn();
    hydrateDetail(root, load);
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-hpm-canvas]')!.tabIndex).toBe(-1);
    expect(root.querySelector('[data-hpm-status]')!.textContent).toContain('暂时无法加载');
  });
});
