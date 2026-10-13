import type { Coordinate } from '../../domain/types';
import { loadAMapApi, type AMapSdkApi } from '../providers/amap-sdk';
import type { BrowserProviderConfig } from '../providers/types';

export interface AuthorPlaceSearchQuery {
  keyword: string;
  city: string;
}
export interface AuthorPlace {
  name: string;
  city: string;
  address: string;
  coordinate: Coordinate;
}
export type AuthorPlaceSearchOutcome =
  | { state: 'success'; places: readonly AuthorPlace[] }
  | { state: 'error'; reason: 'quota' | 'configuration' | 'timeout' | 'unavailable' }
  | { state: 'cancelled' };
export type AuthorPlaceSearch = (
  query: AuthorPlaceSearchQuery,
  signal: AbortSignal,
) => Promise<AuthorPlaceSearchOutcome>;

interface SearchApi extends AMapSdkApi {
  PlaceSearch: new (options: Record<string, unknown>) => {
    search(keyword: string, callback: (status: string, result: unknown) => void): void;
  };
}
const MAX_RESULTS = 10;
const TIMEOUT_MS = 10_000;
const quotaErrors = new Set([
  'DAILY_QUERY_OVER_LIMIT',
  'USER_DAILY_QUERY_OVER_LIMIT',
  'TOTAL_QUERY_OVER_LIMIT',
  'ACCESS_TOO_FREQUENT',
  'CUQPS_HAS_EXCEEDED_THE_LIMIT',
  'CQPS_HAS_EXCEEDED_THE_LIMIT',
  'CKQPS_HAS_EXCEEDED_THE_LIMIT',
  'QPS_HAS_EXCEEDED_THE_LIMIT',
  'IP_QUERY_OVER_LIMIT',
  'QUOTA_PLAN_RUN_OUT',
]);
const configurationErrors = new Set([
  'INVALID_USER_KEY',
  'INVALID_USER_SCODE',
  'INVALID_USER_SIGNATURE',
  'INVALID_USER_DOMAIN',
  'USERKEY_PLAT_NOMATCH',
  'INSUFFICIENT_PRIVILEGES',
  'USERKEY_NOT_EXIST',
  'USERKEY_EXPIRED',
  'INVALID_USER_IP',
  'SERVICE_NOT_AVAILABLE',
  'USER_KEY_RECYCLED',
  'NO_EFFECTIVE_INTERFACE',
  'SERVICE_EXPIRED',
]);
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}
function places(result: unknown): AuthorPlace[] {
  const pois = record(record(result)?.poiList)?.pois;
  if (!Array.isArray(pois)) return [];
  const normalized: AuthorPlace[] = [];
  // Bound both display count and work, even if an unexpected SDK payload is oversized.
  for (const value of pois.slice(0, 100)) {
    try {
      const poi = record(value);
      const name = text(poi?.name, 200);
      const location = record(poi?.location);
      if (!name || !location) continue;
      const longitude: unknown =
        typeof location.getLng === 'function'
          ? Reflect.apply(location.getLng, location, [])
          : location.lng;
      const latitude: unknown =
        typeof location.getLat === 'function'
          ? Reflect.apply(location.getLat, location, [])
          : location.lat;
      if (
        typeof longitude !== 'number' ||
        typeof latitude !== 'number' ||
        !Number.isFinite(longitude) ||
        !Number.isFinite(latitude) ||
        Math.abs(longitude) > 180 ||
        Math.abs(latitude) > 90
      )
        continue;
      normalized.push({
        name,
        city: text(poi?.cityname, 120) || text(poi?.pname, 120),
        address: text(poi?.address, 400) || text(poi?.adname, 120),
        coordinate: [longitude, latitude],
      });
      if (normalized.length === MAX_RESULTS) break;
    } catch {
      /* One malformed POI cannot discard the other usable results. */
    }
  }
  return normalized;
}
function failure(result: unknown): AuthorPlaceSearchOutcome {
  const info = typeof result === 'string' ? result : record(result)?.info;
  return {
    state: 'error',
    reason:
      typeof info === 'string' && quotaErrors.has(info)
        ? 'quota'
        : typeof info === 'string' && configurationErrors.has(info)
          ? 'configuration'
          : 'unavailable',
  };
}

/** Author-only, explicitly requested keyword search; never attach vendor markers or panels. */
export function searchAuthorPlaces(
  config: BrowserProviderConfig,
  query: AuthorPlaceSearchQuery,
  signal: AbortSignal,
): Promise<AuthorPlaceSearchOutcome> {
  if (signal.aborted) return Promise.resolve({ state: 'cancelled' });
  const keyword = query.keyword.trim();
  const city = query.city.trim();
  if (!keyword || keyword.length > 100 || city.length > 60)
    return Promise.resolve({ state: 'error', reason: 'unavailable' });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: AuthorPlaceSearchOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      resolve(outcome);
    };
    const cancel = () => finish({ state: 'cancelled' });
    const unavailable = () => finish({ state: 'error', reason: 'unavailable' });
    const timer = setTimeout(() => finish({ state: 'error', reason: 'timeout' }), TIMEOUT_MS);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    void loadAMapApi<SearchApi>(config).then((api) => {
      if (settled) return;
      try {
        if (!api.plugin) {
          unavailable();
          return;
        }
        api.plugin(['AMap.PlaceSearch'], () => {
          if (settled) return;
          try {
            const search = new api.PlaceSearch({
              city: city || '全国',
              citylimit: !!city,
              pageSize: MAX_RESULTS,
              pageIndex: 1,
              extensions: 'base',
              autoFitView: false,
            });
            search.search(keyword, (status, result) => {
              if (settled) return;
              try {
                finish(
                  status === 'complete'
                    ? { state: 'success', places: places(result) }
                    : status === 'no_data'
                      ? { state: 'success', places: [] }
                      : failure(result),
                );
              } catch {
                unavailable();
              }
            });
          } catch {
            unavailable();
          }
        });
      } catch {
        unavailable();
      }
    }, unavailable);
  });
}
