import type { BrowserRuntime } from './runtime';
import type { FeatureId, RuntimeHydrator } from './types';

export const BROWSER_RUNTIME_KEY = Symbol.for('hexo-post-map.browser-runtime.v1');
export const PENDING_HYDRATORS_KEY = Symbol.for('hexo-post-map.pending-hydrators.v1');

export function registerRuntimeHydrator(hydrator: RuntimeHydrator, page: Window = window): void {
  const runtime = Reflect.get(page, BROWSER_RUNTIME_KEY) as BrowserRuntime | undefined;
  if (runtime) {
    runtime.register(hydrator);
    return;
  }
  let pending = Reflect.get(page, PENDING_HYDRATORS_KEY) as
    Map<FeatureId, RuntimeHydrator> | undefined;
  if (!pending) {
    pending = new Map();
    Object.defineProperty(page, PENDING_HYDRATORS_KEY, { value: pending });
  }
  if (!pending.has(hydrator.id)) pending.set(hydrator.id, hydrator);
}
