import type { NormalizedPostMap } from '../../domain/types';
import type { DetailTrackDescriptor } from '../../presentation/track';
import type { BrowserProviderConfig } from '../providers/types';

export interface DetailBrowserConfig extends BrowserProviderConfig {
  readonly map: NormalizedPostMap;
  readonly defaultZoom: number;
  readonly height: string;
  readonly track?: DetailTrackDescriptor;
}

const TRACK_KEYS = new Set(['url', 'stats', 'playback']);
const STATISTIC_KEYS = new Set(['distanceMeters', 'elevationGainMeters', 'durationSeconds']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function readTrackDescriptor(value: unknown): DetailTrackDescriptor {
  if (!isRecord(value) || !hasOnlyKeys(value, TRACK_KEYS)) throw new Error('Invalid map data');
  if (
    typeof value.url !== 'string' ||
    value.url.length === 0 ||
    typeof value.playback !== 'boolean'
  ) {
    throw new Error('Invalid map data');
  }
  const stats = value.stats;
  if (
    !isRecord(stats) ||
    !hasOnlyKeys(stats, STATISTIC_KEYS) ||
    !finiteNonNegative(stats.distanceMeters) ||
    (stats.elevationGainMeters !== undefined && !finiteNonNegative(stats.elevationGainMeters)) ||
    (stats.durationSeconds !== undefined && !finiteNonNegative(stats.durationSeconds))
  ) {
    throw new Error('Invalid map data');
  }
  return Object.freeze({
    url: value.url,
    playback: value.playback,
    stats: Object.freeze({
      distanceMeters: stats.distanceMeters,
      ...(stats.elevationGainMeters === undefined
        ? {}
        : { elevationGainMeters: stats.elevationGainMeters }),
      ...(stats.durationSeconds === undefined ? {} : { durationSeconds: stats.durationSeconds }),
    }),
  });
}

/** Data is normalized and validated by the SSR template; malformed JSON fails locally. */
export function readDetailConfig(root: HTMLElement): DetailBrowserConfig {
  const data = root.querySelector('[data-hpm-data]');
  if (!data?.textContent) throw new Error('Missing map data');
  const config = JSON.parse(data.textContent) as DetailBrowserConfig;
  if (config.provider !== 'amap' || !config.amap?.key || !config.map?.points?.length) {
    throw new Error('Invalid map data');
  }
  return {
    ...config,
    ...(config.track === undefined ? {} : { track: readTrackDescriptor(config.track) }),
  };
}
