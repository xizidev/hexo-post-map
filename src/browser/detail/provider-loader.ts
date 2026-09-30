import { createAMapDetailProvider } from '../providers/amap';
import type { BrowserProviderConfig, DetailProviderLoader } from '../providers/types';
import { createProviderLoader } from '../shared/provider-loader';

const cacheKey = Symbol.for('hexo-post-map.detail-provider-loader.v1');

export function loadDetailProvider(config: BrowserProviderConfig) {
  const page = window as unknown as Record<symbol, DetailProviderLoader | undefined>;
  page[cacheKey] ??= createProviderLoader(createAMapDetailProvider);
  return page[cacheKey](config);
}
