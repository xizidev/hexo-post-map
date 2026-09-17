// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrateDetail } from '../../src/browser/detail/index';
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
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('detail hydration', () => {
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
    expect(load).not.toHaveBeenCalled();
    expect(options?.rootMargin).toBe('300px');
    intersect([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(load).not.toHaveBeenCalled();
    intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(false);
    expect(root.querySelector('[data-hpm-status]')!.textContent).toContain('加载');
    expect(mountDetail.mock.calls[0]?.[1]).toMatchObject({ map, defaultZoom: 11 });
    pending.resolve(handle);
    await flush();
    expect(root.querySelector<HTMLElement>('[data-hpm-fallback]')!.hidden).toBe(true);
    expect(root.querySelector('[data-hpm-status]')!.textContent).toContain('加载完成');
    expect(disconnect).toHaveBeenCalled();
    controller.destroy();
    expect(handle.destroy).toHaveBeenCalledTimes(1);
  });

  it('requires intentional activation and releases interaction with Escape', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = fixture();
    const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
    const controller = hydrateDetail(root, async () => ({
      mountDetail: async () => handle,
      mountOverview: vi.fn(),
    }));
    await flush();
    const activate = root.querySelector<HTMLButtonElement>('[data-hpm-activate]')!;
    expect(activate.type).toBe('button');
    expect(root.dataset.hpmActive).not.toBe('true');
    expect(handle.setInteractive).not.toHaveBeenCalledWith(true);
    root.dispatchEvent(new WheelEvent('wheel', { cancelable: true }));
    expect(handle.setInteractive).not.toHaveBeenCalledWith(true);
    activate.click();
    expect(handle.setInteractive).toHaveBeenLastCalledWith(true);
    expect(root.dataset.hpmActive).toBe('true');
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(handle.setInteractive).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(activate);
    controller.destroy();
  });

  it.each(['load', 'mount', 'runtime'])(
    'retains or restores fallback on %s failure',
    async (stage) => {
      vi.stubGlobal('IntersectionObserver', undefined);
      const root = fixture();
      const handle = { destroy: vi.fn(), setInteractive: vi.fn() };
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
      if (stage === 'runtime') model.onError?.();
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
    expect(root.querySelector('[data-hpm-status]')!.textContent).toContain('暂时无法加载');
  });
});
