// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchAuthorPlaces } from '../../src/browser/author/search';

const sdk = vi.hoisted(() => ({ load: vi.fn(), reset: vi.fn() }));
vi.mock('@amap/amap-jsapi-loader', () => ({ default: sdk }));
const config = {
  provider: 'amap' as const,
  amap: { key: 'fixture', securityJsCode: 'fixture', mapStyle: 'amap://styles/normal' },
};
type Callback = (status: string, result: unknown) => void;
const calls: { options: Record<string, unknown>; keyword: string; callback: Callback }[] = [];
const plugin = vi.fn((_names: string[], ready: () => void) => ready());
class PlaceSearch {
  constructor(readonly options: Record<string, unknown>) {}
  search(keyword: string, callback: Callback) {
    calls.push({ options: this.options, keyword, callback });
  }
}
const api = { Map: vi.fn(), Marker: vi.fn(), Polyline: vi.fn(), PlaceSearch, plugin };
const poi = {
  name: ' 南京南站 ',
  cityname: '南京市',
  address: '雨花台区玉兰路',
  location: { getLng: () => 118.79687712345, getLat: () => 31.96867898765 },
};
const flush = async () => {
  for (let index = 0; index < 6; index++) await Promise.resolve();
};
function run(signal = new AbortController().signal, city = '') {
  return searchAuthorPlaces(config, { keyword: '南京南站', city }, signal);
}
beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  sdk.load.mockReset().mockResolvedValue(api);
  plugin.mockReset().mockImplementation((_names, ready) => ready());
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('author keyword search provider boundary', () => {
  it.each([
    'CQPS_HAS_EXCEEDED_THE_LIMIT',
    'CKQPS_HAS_EXCEEDED_THE_LIMIT',
    'QPS_HAS_EXCEEDED_THE_LIMIT',
    'IP_QUERY_OVER_LIMIT',
    'QUOTA_PLAN_RUN_OUT',
    'SERVICE_NOT_AVAILABLE',
    'USER_KEY_RECYCLED',
    'NO_EFFECTIVE_INTERFACE',
    'SERVICE_EXPIRED',
  ])('classifies official %s from string and object responses', async (info) => {
    const reason = [
      'SERVICE_NOT_AVAILABLE',
      'USER_KEY_RECYCLED',
      'NO_EFFECTIVE_INTERFACE',
      'SERVICE_EXPIRED',
    ].includes(info)
      ? 'configuration'
      : 'quota';
    for (const payload of [info, { info }]) {
      const pending = run();
      await flush();
      calls.at(-1)!.callback('error', payload);
      expect(await pending).toEqual({ state: 'error', reason });
    }
  });
  it('loads only PlaceSearch lazily and owns no vendor map, panel or automatic overlays', async () => {
    expect(plugin).not.toHaveBeenCalled();
    const pending = run();
    await flush();
    expect(plugin).toHaveBeenCalledExactlyOnceWith(['AMap.PlaceSearch'], expect.any(Function));
    expect(calls[0]?.options).toMatchObject({
      city: '全国',
      citylimit: false,
      pageSize: 10,
      pageIndex: 1,
      extensions: 'base',
      autoFitView: false,
    });
    expect(calls[0]?.options).not.toHaveProperty('map');
    expect(calls[0]?.options).not.toHaveProperty('panel');
    calls[0]!.callback('complete', { poiList: { pois: [poi] } });
    expect(await pending).toEqual({
      state: 'success',
      places: [
        {
          name: '南京南站',
          city: '南京市',
          address: '雨花台区玉兰路',
          coordinate: [118.79687712345, 31.96867898765],
        },
      ],
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('restricts a requested city, not a hidden current viewport', async () => {
    const pending = run(undefined, '南京');
    await flush();
    expect(calls[0]?.options).toMatchObject({ city: '南京', citylimit: true });
    calls[0]!.callback('no_data', {});
    expect(await pending).toEqual({ state: 'success', places: [] });
  });
  it('filters unusable coordinates, empty names and throwing SDK accessors', async () => {
    const throwing = {
      ...poi,
      location: {
        getLng() {
          throw new Error('unsafe');
        },
        getLat: () => 31,
      },
    };
    const pending = run();
    await flush();
    calls[0]!.callback('complete', {
      poiList: {
        pois: [
          null,
          { ...poi, name: '' },
          { ...poi, location: { getLng: () => Infinity, getLat: () => 31 } },
          { ...poi, location: { getLng: () => 181, getLat: () => 31 } },
          throwing,
          poi,
        ],
      },
    });
    const result = await pending;
    expect(result.state === 'success' && result.places).toHaveLength(1);
  });
  it('bounds result count and display strings while treating markup as plain text', async () => {
    const pending = run();
    await flush();
    calls[0]!.callback('complete', {
      poiList: {
        pois: Array.from({ length: 30 }, (_, index) => ({
          ...poi,
          name: index === 0 ? '<script>unsafe</script>' : 'x'.repeat(1000),
          address: 'a'.repeat(2000),
        })),
      },
    });
    const result = await pending;
    expect(result.state).toBe('success');
    if (result.state !== 'success') throw new Error('Expected success');
    expect(result.places).toHaveLength(10);
    expect(result.places[0]?.name).toBe('<script>unsafe</script>');
    expect(result.places[1]!.name.length).toBeLessThanOrEqual(200);
    expect(result.places[1]!.address.length).toBeLessThanOrEqual(400);
  });
  it.each([
    'DAILY_QUERY_OVER_LIMIT',
    'USER_DAILY_QUERY_OVER_LIMIT',
    'ACCESS_TOO_FREQUENT',
    'TOTAL_QUERY_OVER_LIMIT',
  ])('classifies %s without exposing vendor payloads', async (info) => {
    const pending = run();
    await flush();
    calls[0]!.callback('error', { info, private: 'key=secret' });
    expect(await pending).toEqual({ state: 'error', reason: 'quota' });
  });
  it.each([
    'INVALID_USER_KEY',
    'INVALID_USER_SCODE',
    'INVALID_USER_DOMAIN',
    'USERKEY_PLAT_NOMATCH',
  ])('classifies %s as configuration/permission failure', async (info) => {
    const pending = run();
    await flush();
    calls[0]!.callback('error', { info });
    expect(await pending).toEqual({ state: 'error', reason: 'configuration' });
  });
  it('does not report malformed or unknown failures as successful empty data', async () => {
    const pending = run();
    await flush();
    calls[0]!.callback('error', 'key=secret');
    expect(await pending).toEqual({ state: 'error', reason: 'unavailable' });
  });
  it('returns no results for ambiguous city-only data instead of inventing coordinates', async () => {
    const pending = run();
    await flush();
    calls[0]!.callback('complete', { cityList: [{ name: '南京' }] });
    expect(await pending).toEqual({ state: 'success', places: [] });
  });
  it('does not load the SDK for an already cancelled request', async () => {
    const abort = new AbortController();
    abort.abort();
    expect(await run(abort.signal)).toEqual({ state: 'cancelled' });
    expect(sdk.load).not.toHaveBeenCalled();
  });
  it('cancels promptly during SDK loading and does not start a late plugin', async () => {
    let loaded!: (value: typeof api) => void;
    sdk.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          loaded = resolve;
        }),
    );
    const abort = new AbortController();
    const pending = run(abort.signal);
    abort.abort();
    expect(await pending).toEqual({ state: 'cancelled' });
    loaded(api);
    await flush();
    expect(plugin).not.toHaveBeenCalled();
  });
  it('cancels a pending plugin and ignores its late ready callback', async () => {
    let ready!: () => void;
    plugin.mockImplementation((_names, callback) => {
      ready = callback;
    });
    const abort = new AbortController();
    const pending = run(abort.signal);
    await flush();
    abort.abort();
    expect(await pending).toEqual({ state: 'cancelled' });
    ready();
    expect(calls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels a pending query and ignores its late result', async () => {
    const abort = new AbortController();
    const pending = run(abort.signal);
    await flush();
    abort.abort();
    expect(await pending).toEqual({ state: 'cancelled' });
    calls[0]!.callback('complete', { poiList: { pois: [poi] } });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out plugin loading and does not start a late search', async () => {
    let ready!: () => void;
    plugin.mockImplementation((_names, callback) => {
      ready = callback;
    });
    const pending = run();
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ state: 'error', reason: 'timeout' });
    ready();
    expect(calls).toHaveLength(0);
  });
  it('times out a query and ignores a late success', async () => {
    const pending = run();
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ state: 'error', reason: 'timeout' });
    calls[0]!.callback('complete', { poiList: { pois: [poi] } });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('handles SDK/plugin errors without reflecting exception details', async () => {
    plugin.mockImplementation(() => {
      throw new Error('key=secret');
    });
    const pending = run();
    expect(await pending).toEqual({ state: 'error', reason: 'unavailable' });
  });
});
