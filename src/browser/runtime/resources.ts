import { FEATURES, type FeatureId, type FeatureResourceLoader } from './types';

export { FEATURES } from './types';

type ResourceElement = HTMLLinkElement | HTMLScriptElement;
type ResourceState = {
  status: 'idle' | 'pending' | 'ready' | 'failed';
  element?: ResourceElement;
  promise?: Promise<boolean>;
  settle?: (ready: boolean) => void;
  cleanup?: () => void;
};

export function createFeatureResourceLoader(options: {
  document: Document;
  assetBase: URL;
  hasHydrator(feature: FeatureId): boolean;
}): FeatureResourceLoader {
  const { document, assetBase, hasHydrator } = options;
  const styleUrl = new URL('style.css', assetBase).href;
  const scriptUrls = {
    detail: new URL(FEATURES.detail.script, assetBase).href,
    overview: new URL(FEATURES.overview.script, assetBase).href,
  };
  const style: ResourceState = { status: 'idle' };
  const scripts: Record<FeatureId, ResourceState> = {
    detail: { status: 'idle' },
    overview: { status: 'idle' },
  };
  let stopped = false;

  function matchingStyle(): HTMLLinkElement | undefined {
    const canonical = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'),
    ).filter((link) => !link.disabled && link.href === styleUrl);
    return canonical.find((link) => link.sheet !== null) ?? canonical[0];
  }

  function matchingScript(feature: FeatureId): HTMLScriptElement | undefined {
    return Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]')).find(
      (script) => script.src === scriptUrls[feature],
    );
  }

  function load(state: ResourceState, feature: FeatureId | undefined, retryFailed: boolean) {
    if (stopped) return Promise.resolve(false);
    if (state.status === 'ready') return Promise.resolve(true);
    if (state.status === 'pending') return state.promise!;
    if (state.status === 'failed') {
      if (!retryFailed) return Promise.resolve(false);
      const failed = state.element;
      if (
        failed?.isConnected &&
        (feature === undefined
          ? failed.tagName === 'LINK' &&
            (failed as HTMLLinkElement).relList.contains('stylesheet') &&
            (failed as HTMLLinkElement).href === styleUrl
          : failed.tagName === 'SCRIPT' &&
            (failed as HTMLScriptElement).src === scriptUrls[feature])
      ) {
        failed.remove();
      }
      state.element = undefined;
      state.status = 'idle';
    }

    const existing = feature === undefined ? matchingStyle() : matchingScript(feature);
    if (
      (feature === undefined && existing && (existing as HTMLLinkElement).sheet !== null) ||
      (feature !== undefined && hasHydrator(feature))
    ) {
      state.status = 'ready';
      state.element = existing;
      return Promise.resolve(true);
    }

    const element =
      existing ??
      (feature === undefined ? document.createElement('link') : document.createElement('script'));
    if (!existing) {
      if (feature === undefined) {
        const link = element as HTMLLinkElement;
        link.rel = 'stylesheet';
        link.href = styleUrl;
      } else {
        (element as HTMLScriptElement).src = scriptUrls[feature];
      }
    }
    state.element = element;
    state.status = 'pending';
    state.promise = new Promise<boolean>((resolve) => {
      state.settle = (ready) => {
        if (state.status !== 'pending') return;
        state.cleanup?.();
        state.cleanup = undefined;
        state.settle = undefined;
        state.status = ready ? 'ready' : 'failed';
        resolve(ready);
      };
      const onLoad = () => state.settle?.(feature === undefined || hasHydrator(feature));
      const onError = () => state.settle?.(false);
      element.addEventListener('load', onLoad, { once: true });
      element.addEventListener('error', onError, { once: true });
      state.cleanup = () => {
        element.removeEventListener('load', onLoad);
        element.removeEventListener('error', onError);
      };
    });
    if (!existing) {
      try {
        (feature === undefined ? document.head : document.body).append(element);
      } catch {
        state.settle?.(false);
      }
    }
    return state.promise;
  }

  return {
    ensure(feature, retryFailed = false) {
      if (stopped) return Promise.resolve(false);
      const styleReady = load(style, undefined, retryFailed);
      const scriptReady = load(scripts[feature], feature, retryFailed);
      return new Promise<boolean>((resolve) => {
        let styleDone = false;
        let scriptDone = false;
        styleReady.then((ready) => {
          if (!ready) resolve(false);
          else {
            styleDone = true;
            if (scriptDone) resolve(!stopped && hasHydrator(feature));
          }
        });
        scriptReady.then((ready) => {
          if (!ready) resolve(false);
          else {
            scriptDone = true;
            if (styleDone) resolve(!stopped && hasHydrator(feature));
          }
        });
      });
    },
    isReady(feature) {
      return (
        !stopped &&
        style.status === 'ready' &&
        scripts[feature].status === 'ready' &&
        hasHydrator(feature)
      );
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const state of [style, scripts.detail, scripts.overview]) {
        state.settle?.(false);
      }
    },
  };
}
