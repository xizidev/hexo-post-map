import type { NormalizedPostMap } from '../../domain/types';
import type { BrowserProviderConfig } from '../providers/types';

export interface DetailBrowserConfig extends BrowserProviderConfig {
  readonly map: NormalizedPostMap;
  readonly defaultZoom: number;
  readonly height: string;
}

/** Data is normalized and validated by the SSR template; malformed JSON fails locally. */
export function readDetailConfig(root: HTMLElement): DetailBrowserConfig {
  const data = root.querySelector('[data-hpm-data]');
  if (!data?.textContent) throw new Error('Missing map data');
  const config = JSON.parse(data.textContent) as DetailBrowserConfig;
  if (config.provider !== 'amap' || !config.amap?.key || !config.map?.points?.length) {
    throw new Error('Invalid map data');
  }
  return config;
}
