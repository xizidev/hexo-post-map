import { createAMapProvider } from '../providers/amap';
import type { BrowserProviderConfig, MapProvider, ProviderLoader } from '../providers/types';

export function createProviderLoader(factory: ProviderLoader): ProviderLoader {
  let pending: Promise<MapProvider> | undefined;
  let identity: string | undefined;
  return (config: BrowserProviderConfig) => {
    const current = JSON.stringify([
      config.provider,
      config.amap.key,
      config.amap.mapStyle,
      config.amap.serviceHost,
      config.amap.securityJsCode,
    ]);
    if (pending) {
      return current === identity
        ? pending
        : Promise.reject(new Error('Conflicting map provider configuration'));
    }
    identity = current;
    pending = Promise.resolve()
      .then(() => factory(config))
      .catch((error: unknown) => {
        pending = undefined;
        identity = undefined;
        throw error;
      });
    return pending;
  };
}

// Both IIFE bundles share the same successful/pending load, including the SDK module instance.
const cacheKey = Symbol.for('hexo-post-map.provider-loader.v1');
export function loadProvider(config: BrowserProviderConfig): Promise<MapProvider> {
  const page = window as unknown as Record<symbol, ProviderLoader | undefined>;
  page[cacheKey] ??= createProviderLoader(createAMapProvider);
  return page[cacheKey](config);
}
