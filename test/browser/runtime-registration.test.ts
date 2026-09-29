// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeController, RuntimeHydrator } from '../../src/browser/runtime/types';

const register = vi.hoisted(() => vi.fn<(hydrator: RuntimeHydrator) => void>());
vi.mock('../../src/browser/runtime/bridge', () => ({ registerRuntimeHydrator: register }));

const controllers = new Set<RuntimeController>();
afterEach(() => {
  controllers.forEach((controller) => controller.destroy());
  controllers.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  register.mockClear();
});

describe.each(['loading', 'complete'] as const)('feature registration while %s', (readyState) => {
  it.each(['detail', 'overview'] as const)(
    'registers the real %s hydrator without initializing or owning page lifecycle',
    async (feature) => {
      vi.resetModules();
      vi.spyOn(document, 'readyState', 'get').mockReturnValue(readyState);
      // Invalid config keeps this registration contract test independent of external SDKs.
      document.body.innerHTML = `<section data-hpm-${feature}>
        <div data-hpm-canvas></div><script data-hpm-data type="application/json">{}</script>
        <p data-hpm-status></p><div data-hpm-fallback></div>
      </section>`;
      const root = document.querySelector<HTMLElement>(`[data-hpm-${feature}]`)!;
      const documentListener = vi.spyOn(document, 'addEventListener');
      const windowListener = vi.spyOn(window, 'addEventListener');
      const hydrate =
        feature === 'detail'
          ? (await import('../../src/browser/detail/index')).hydrateDetail
          : (await import('../../src/browser/overview/index')).hydrateOverview;

      const lifecycle = ['DOMContentLoaded', 'pagehide', 'pageshow'];
      expect
        .soft(documentListener.mock.calls.filter(([type]) => lifecycle.includes(type)))
        .toEqual([]);
      expect
        .soft(windowListener.mock.calls.filter(([type]) => lifecycle.includes(type)))
        .toEqual([]);
      expect.soft(root.querySelector('[data-hpm-status]')!.textContent).toBe('');
      expect.soft(root.hasAttribute('data-hpm-active')).toBe(false);
      expect(register).toHaveBeenCalledTimes(1);
      const registration = register.mock.calls[0]![0];
      expect(registration).toMatchObject({ id: feature, selector: `[data-hpm-${feature}]` });

      const controller = registration.mount(root);
      controllers.add(controller);
      expect(controller).toBe(hydrate(root));
      expect(controller.isCurrent()).toBe(true);
      expect(root.querySelector('[data-hpm-status]')!.textContent).toContain('暂时无法加载');
      expect(documentListener.mock.calls.filter(([type]) => lifecycle.includes(type))).toEqual([]);
      expect(windowListener.mock.calls.filter(([type]) => lifecycle.includes(type))).toEqual([]);
      controller.destroy();
      expect(controller.isCurrent()).toBe(false);
    },
  );
});
