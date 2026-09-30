import { createAMapOverviewProvider } from '../providers/amap-overview';
import type { BrowserProviderConfig, OverviewProviderLoader } from '../providers/types';
import { createProviderLoader } from '../shared/provider-loader';

const cacheKey = Symbol.for('hexo-post-map.overview-provider-loader.v1');

export function loadOverviewProvider(config: BrowserProviderConfig) {
  const page = window as unknown as Record<symbol, OverviewProviderLoader | undefined>;
  page[cacheKey] ??= createProviderLoader(createAMapOverviewProvider);
  return page[cacheKey](config);
}
