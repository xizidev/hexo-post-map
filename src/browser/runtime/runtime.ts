import { BROWSER_RUNTIME_KEY, PENDING_HYDRATORS_KEY } from './bridge';
import { createFeatureResourceLoader } from './resources';
import {
  FEATURES,
  type FeatureId,
  type FeatureResourceLoader,
  type HexoPostMapBrowserApi,
  type RuntimeController,
  type RuntimeHydrator,
} from './types';

export interface BrowserRuntime {
  readonly api: HexoPostMapBrowserApi;
  register(hydrator: RuntimeHydrator): void;
  start(): void;
}

export interface BrowserRuntimeOptions {
  readonly page: Window;
  readonly document: Document;
  readonly assetBase: URL;
  readonly mutationObserver: typeof MutationObserver | null;
  readonly resources?: FeatureResourceLoader;
}

type Scope = Document | DocumentFragment | Element;
const FEATURE_IDS: readonly FeatureId[] = ['detail', 'overview'];
const WARNING = 'HexoPostMap: a runtime operation failed.';
const API_WARNING = 'HexoPostMap: the manual API could not be exposed.';

export function createBrowserRuntime(options: BrowserRuntimeOptions): BrowserRuntime {
  const { page, document } = options;
  const realm = document.defaultView!;
  const hydrators = new Map<FeatureId, RuntimeHydrator>();
  const generations = new WeakMap<HTMLElement, number>();
  const pendingRoots = new Set<ReadonlySet<HTMLElement>>();
  const active = new Map<
    HTMLElement,
    { hydrator: RuntimeHydrator; controller: RuntimeController }
  >();
  const resources =
    options.resources ??
    createFeatureResourceLoader({
      document,
      assetBase: options.assetBase,
      hasHydrator: (feature) => hydrators.has(feature),
    });
  const pendingScopes = new Set<Scope>();
  let observer: MutationObserver | undefined;
  let started = false;
  let ready = false;
  let stopped = false;
  let queued = false;

  const warn = () => realm.console.warn(WARNING);
  const connected = (root: HTMLElement) => root.ownerDocument === document && root.isConnected;

  function validateScope(scope: Scope | undefined): Scope {
    if (scope === undefined || scope === document) return document;
    if (
      (scope instanceof realm.Element || scope instanceof realm.DocumentFragment) &&
      scope.ownerDocument === document
    )
      return scope;
    throw new TypeError('HexoPostMap: scope must belong to this document.');
  }

  function destroy(root: HTMLElement): void {
    generations.set(root, (generations.get(root) ?? 0) + 1);
    const record = active.get(root);
    if (!record) return;
    active.delete(root);
    try {
      record.controller.destroy();
    } catch {
      warn();
    }
  }

  function sweep(): void {
    for (const [root, record] of active) {
      let current = false;
      try {
        current =
          connected(root) &&
          root.matches(record.hydrator.selector) &&
          record.controller.isCurrent();
      } catch {
        warn();
      }
      if (!current) destroy(root);
    }
  }

  function mount(feature: FeatureId, roots: Iterable<HTMLElement>): void {
    const hydrator = hydrators.get(feature);
    if (!hydrator || stopped) return;
    for (const root of roots) {
      if (!connected(root) || active.has(root) || !root.matches(hydrator.selector)) continue;
      try {
        active.set(root, { hydrator, controller: hydrator.mount(root) });
      } catch {
        warn();
      }
    }
  }

  function failed(feature: FeatureId, roots: Iterable<HTMLElement>): void {
    if (stopped) return;
    for (const root of roots) {
      if (!connected(root) || active.has(root)) continue;
      const status = root.querySelector('[data-hpm-status]');
      const message = FEATURES[feature].failureMessage;
      if (status && status.textContent !== message) status.textContent = message;
    }
  }

  function reconcile(scopes: Iterable<Scope>, retry: boolean): void {
    if (!started || !ready || stopped) return;
    sweep();
    const candidates = new Map<FeatureId, Set<HTMLElement>>();
    for (const scope of scopes) {
      for (const feature of FEATURE_IDS) {
        const roots = candidates.get(feature) ?? new Set<HTMLElement>();
        const selector = FEATURES[feature].selector;
        if (scope instanceof realm.HTMLElement && scope.matches(selector) && connected(scope))
          roots.add(scope);
        for (const root of scope.querySelectorAll<HTMLElement>(selector)) {
          if (root instanceof realm.HTMLElement && connected(root)) roots.add(root);
        }
        if (roots.size) candidates.set(feature, roots);
      }
    }
    for (const [feature, roots] of candidates) {
      try {
        const attempts = [...roots].map((root) => ({
          root,
          generation: generations.get(root) ?? 0,
        }));
        const currentRoots = () =>
          attempts
            .filter(({ root, generation }) => (generations.get(root) ?? 0) === generation)
            .map(({ root }) => root);
        const pending = resources.ensure(feature, retry);
        pendingRoots.add(roots);
        let mountedSynchronously = false;
        // Install the rejection handler before consulting readiness, which may throw.
        void pending
          .then((loaded) => {
            if (stopped) return;
            if (loaded) {
              if (!mountedSynchronously) mount(feature, currentRoots());
            } else failed(feature, currentRoots());
          })
          .catch(() => {
            if (!stopped) {
              warn();
              failed(feature, currentRoots());
            }
          })
          .finally(() => {
            pendingRoots.delete(roots);
          });
        if (resources.isReady(feature)) {
          mountedSynchronously = true;
          mount(feature, roots);
        }
      } catch {
        warn();
        failed(feature, roots);
      }
    }
  }

  function queue(scopes: Iterable<Scope>): void {
    if (stopped) return;
    for (const scope of scopes) pendingScopes.add(scope);
    if (queued) return;
    queued = true;
    page.queueMicrotask(() => {
      queued = false;
      const scopes = [...pendingScopes];
      pendingScopes.clear();
      reconcile(scopes, false);
    });
  }

  function onReady(): void {
    if (ready || stopped) return;
    ready = true;
    if (options.mutationObserver) {
      observer = new options.mutationObserver((records) => {
        const scopes = new Set<Scope>();
        for (const record of records) {
          if (record.target instanceof realm.Element) {
            scopes.add(record.target);
            for (const feature of FEATURE_IDS) {
              const root = record.target.closest(FEATURES[feature].selector);
              if (root) scopes.add(root);
            }
          }
          for (const node of record.addedNodes) {
            if (node instanceof realm.Element) scopes.add(node);
          }
        }
        queue(scopes);
      });
      observer.observe(document, { childList: true, subtree: true });
    }
    reconcile([document], false);
  }

  function onPageHide(event: PageTransitionEvent): void {
    if (event.persisted || stopped) return;
    stopped = true;
    observer?.disconnect();
    pendingScopes.clear();
    pendingRoots.clear();
    document.removeEventListener('DOMContentLoaded', onReady);
    page.removeEventListener('pagehide', onPageHide);
    page.removeEventListener('pageshow', onPageShow);
    try {
      resources.stop();
    } catch {
      warn();
    }
    for (const root of active.keys()) destroy(root);
  }

  function onPageShow(event: PageTransitionEvent): void {
    if (event.persisted) reconcile([document], false);
  }

  const api: HexoPostMapBrowserApi = Object.freeze({
    apiVersion: 1,
    refresh(scope?: Scope) {
      reconcile([validateScope(scope)], true);
    },
    destroy(scope?: Scope) {
      const target = validateScope(scope);
      const roots = new Set(active.keys());
      for (const pending of pendingRoots) {
        for (const root of pending) roots.add(root);
      }
      for (const root of roots) {
        if (target === document || target === root || target.contains(root)) destroy(root);
      }
    },
  });

  return {
    api,
    register(hydrator) {
      if (stopped || hydrators.has(hydrator.id)) return;
      hydrators.set(hydrator.id, hydrator);
      if (ready) reconcile([document], false);
    },
    start() {
      if (started || stopped) return;
      started = true;
      if ('HexoPostMap' in page) realm.console.warn(API_WARNING);
      else Object.defineProperty(page, 'HexoPostMap', { value: api });
      page.addEventListener('pagehide', onPageHide);
      page.addEventListener('pageshow', onPageShow);
      if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', onReady, { once: true });
      else onReady();
    },
  };
}

export function installBrowserRuntime(script: HTMLScriptElement): BrowserRuntime {
  const document = script.ownerDocument;
  const page = document.defaultView!;
  const existing = Reflect.get(page, BROWSER_RUNTIME_KEY) as BrowserRuntime | undefined;
  if (existing) return existing;
  const runtime = createBrowserRuntime({
    page,
    document,
    assetBase: new URL('.', script.src),
    mutationObserver: typeof page.MutationObserver === 'function' ? page.MutationObserver : null,
  });
  Object.defineProperty(page, BROWSER_RUNTIME_KEY, { value: runtime });
  const pending = Reflect.get(page, PENDING_HYDRATORS_KEY) as
    Map<FeatureId, RuntimeHydrator> | undefined;
  if (pending) {
    for (const hydrator of pending.values()) runtime.register(hydrator);
    pending.clear();
  }
  runtime.start();
  return runtime;
}
