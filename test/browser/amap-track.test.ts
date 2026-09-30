// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTrackProgressGeometry,
  convertTrackFromGps,
  type AMapTrackConversionApi,
  type ConvertedTrack,
} from '../../src/browser/providers/amap-track';
import type { PublishedTrackAsset, PublishedTrackCoordinate } from '../../src/tracks/types';

function asset(segments: readonly (readonly PublishedTrackCoordinate[])[]): PublishedTrackAsset {
  return {
    version: 1,
    coordinateSystem: 'wgs84',
    segments,
    stats: { distanceMeters: 1 },
  };
}

function coordinates(count: number, offset = 0): PublishedTrackCoordinate[] {
  return Array.from({ length: count }, (_, index) => [100 + (offset + index) / 1_000, 20]);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AMap recorded-track conversion', () => {
  it('converts exact 40/40/remainder batches and reconstructs every segment in order', async () => {
    const first = coordinates(41);
    const second = coordinates(40, first.length);
    const batches: number[][][] = [];
    const api: AMapTrackConversionApi = {
      convertFrom(batch, source, callback) {
        expect(source).toBe('gps');
        batches.push(batch.map((coordinate) => [...coordinate]));
        callback('complete', {
          locations: batch.map(([longitude, latitude]) => [longitude + 1, latitude + 2]),
        });
      },
    };

    const converted = await convertTrackFromGps(
      api,
      asset([first, second]),
      new AbortController().signal,
    );

    expect(batches.map((batch) => batch.length)).toEqual([40, 40, 1]);
    expect(batches.flat()).toEqual([...first, ...second]);
    expect(converted.segments.map((segment) => segment.length)).toEqual([41, 40]);
    expect(converted.segments[0]?.[0]).toEqual([101, 22]);
    expect(converted.segments[0]?.[40]).toEqual([101.04, 22]);
    expect(converted.segments[1]?.[0]).toEqual([101.041, 22]);
    expect(converted.segments[1]?.[39]).toEqual([101.08, 22]);
  });

  it('normalizes SDK LngLat objects without retaining vendor values', async () => {
    const api: AMapTrackConversionApi = {
      convertFrom(_batch, _source, callback) {
        callback('complete', {
          locations: [
            { getLng: () => 120.5, getLat: () => 30.25 },
            { getLng: () => 120.75, getLat: () => 30.5 },
          ],
        });
      },
    };

    await expect(
      convertTrackFromGps(
        api,
        asset([
          [
            [120, 30],
            [121, 31],
          ],
        ]),
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      segments: [
        [
          [120.5, 30.25],
          [120.75, 30.5],
        ],
      ],
    });
  });

  it('releases its deadline and abort listener after successful conversion', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const removeListener = vi.spyOn(abort.signal, 'removeEventListener');
    const api: AMapTrackConversionApi = {
      convertFrom(batch, _source, callback) {
        callback('complete', { locations: batch });
      },
    };

    await convertTrackFromGps(api, asset([coordinates(2)]), abort.signal);

    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('rejects an already-aborted conversion before calling the SDK', async () => {
    const abort = new AbortController();
    abort.abort();
    const api = { convertFrom: vi.fn() } as unknown as AMapTrackConversionApi;

    await expect(
      convertTrackFromGps(api, asset([coordinates(2)]), abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(api.convertFrom).not.toHaveBeenCalled();
  });

  it('rejects promptly when aborted during a batch and ignores its late callback', async () => {
    const abort = new AbortController();
    let callback: ((status: string, result?: { readonly locations?: unknown }) => void) | undefined;
    const api: AMapTrackConversionApi = {
      convertFrom(_batch, _source, next) {
        callback = next;
      },
    };
    const pending = convertTrackFromGps(api, asset([coordinates(41)]), abort.signal);

    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    callback?.('complete', { locations: coordinates(40) });
    await Promise.resolve();
    expect(callback).toBeTypeOf('function');
  });

  it('uses one 20-second timeout for the complete conversion', async () => {
    vi.useFakeTimers();
    const api: AMapTrackConversionApi = {
      convertFrom() {},
    };
    const pending = convertTrackFromGps(api, asset([coordinates(2)]), new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(19_999);
    await vi.advanceTimersByTimeAsync(1);

    await rejected;
  });

  it.each([
    {
      name: 'a failed SDK status',
      invoke: (callback: (status: string, result?: { readonly locations?: unknown }) => void) =>
        callback('error', { locations: coordinates(2) }),
    },
    {
      name: 'missing locations',
      invoke: (callback: (status: string, result?: { readonly locations?: unknown }) => void) =>
        callback('complete', {}),
    },
    {
      name: 'a partial locations array',
      invoke: (callback: (status: string, result?: { readonly locations?: unknown }) => void) =>
        callback('complete', { locations: coordinates(1) }),
    },
    {
      name: 'an oversized locations array',
      invoke: (callback: (status: string, result?: { readonly locations?: unknown }) => void) =>
        callback('complete', { locations: coordinates(3) }),
    },
    {
      name: 'a malformed converted coordinate',
      invoke: (callback: (status: string, result?: { readonly locations?: unknown }) => void) =>
        callback('complete', {
          locations: [
            [120, 30],
            [181, 30],
          ],
        }),
    },
    {
      name: 'a sparse locations array',
      invoke: (callback: (status: string, result?: { readonly locations?: unknown }) => void) => {
        const locations = new Array<unknown>(2);
        locations[0] = [120, 30];
        callback('complete', { locations });
      },
    },
  ])('rejects $name without returning mixed coordinates', async ({ invoke }) => {
    const api: AMapTrackConversionApi = {
      convertFrom(_batch, _source, callback) {
        invoke(callback);
      },
    };

    await expect(
      convertTrackFromGps(api, asset([coordinates(2)]), new AbortController().signal),
    ).rejects.toThrow('Track coordinate conversion failed');
  });

  it('normalizes a synchronous SDK throw to the conversion failure boundary', async () => {
    const api: AMapTrackConversionApi = {
      convertFrom() {
        throw new Error('vendor internals');
      },
    };

    await expect(
      convertTrackFromGps(api, asset([coordinates(2)]), new AbortController().signal),
    ).rejects.toThrow('Track coordinate conversion failed');
  });
});

function converted(segments: ConvertedTrack['segments']): ConvertedTrack {
  return { segments };
}

describe('recorded-track progress geometry', () => {
  it('returns the starting coordinate at zero and every segment at one', () => {
    const geometry = createTrackProgressGeometry(
      converted([
        [
          [0, 0],
          [0.01, 0],
        ],
        [
          [10, 0],
          [10.01, 0],
        ],
      ]),
    );

    expect(geometry.at(0)).toEqual({
      paths: [[[0, 0]], []],
      coordinate: [0, 0],
    });
    expect(geometry.at(1)).toEqual({
      paths: [
        [
          [0, 0],
          [0.01, 0],
        ],
        [
          [10, 0],
          [10.01, 0],
        ],
      ],
      coordinate: [10.01, 0],
    });
  });

  it('lands on exact vertex fractions and interpolates inside an edge', () => {
    const geometry = createTrackProgressGeometry(
      converted([
        [
          [0, 0],
          [0.01, 0],
          [0.02, 0],
        ],
      ]),
    );

    expect(geometry.at(0.5)).toEqual({
      paths: [
        [
          [0, 0],
          [0.01, 0],
        ],
      ],
      coordinate: [0.01, 0],
    });
    expect(geometry.at(0.25)).toEqual({
      paths: [
        [
          [0, 0],
          [0.005, 0],
        ],
      ],
      coordinate: [0.005, 0],
    });
  });

  it('never draws the gap between independently recorded segments', () => {
    const geometry = createTrackProgressGeometry(
      converted([
        [
          [0, 0],
          [0.01, 0],
        ],
        [
          [10, 0],
          [10.01, 0],
        ],
      ]),
    );

    const state = geometry.at(0.75);
    expect(state.paths[0]).toEqual([
      [0, 0],
      [0.01, 0],
    ]);
    expect(state.paths[1]?.[0]).toEqual([10, 0]);
    expect(state.paths[1]?.[1]?.[0]).toBeCloseTo(10.005, 12);
    expect(state.paths[1]?.[1]?.[1]).toBe(0);
    expect(state.coordinate[0]).toBeCloseTo(10.005, 12);
    expect(state.coordinate[1]).toBe(0);
  });

  it.each([
    { progress: Number.NaN, coordinate: [0, 0] },
    { progress: Number.POSITIVE_INFINITY, coordinate: [0, 0] },
    { progress: -1, coordinate: [0, 0] },
    { progress: 2, coordinate: [0.02, 0] },
  ])('normalizes progress $progress to a safe endpoint', ({ progress, coordinate }) => {
    const geometry = createTrackProgressGeometry(
      converted([
        [
          [0, 0],
          [0.02, 0],
        ],
      ]),
    );

    expect(geometry.at(progress).coordinate).toEqual(coordinate);
  });

  it('preserves repeated zero-length vertices without dividing by zero', () => {
    const geometry = createTrackProgressGeometry(
      converted([
        [
          [0, 0],
          [0, 0],
          [0.01, 0],
        ],
      ]),
    );

    expect(geometry.at(0.5)).toEqual({
      paths: [
        [
          [0, 0],
          [0, 0],
          [0.005, 0],
        ],
      ],
      coordinate: [0.005, 0],
    });
  });

  it.each([
    {
      name: 'eastward',
      start: [179.9, 0] as const,
      end: [-179.9, 0] as const,
      midpointLongitude: 180,
    },
    {
      name: 'westward',
      start: [-179.9, 0] as const,
      end: [179.9, 0] as const,
      midpointLongitude: -180,
    },
  ])(
    'interpolates $name across the antimeridian on the shortest path',
    ({ start, end, midpointLongitude }) => {
      const geometry = createTrackProgressGeometry(converted([[start, end]]));

      const state = geometry.at(0.5);

      expect(state.coordinate[0]).toBeCloseTo(midpointLongitude, 12);
      expect(state.coordinate[1]).toBe(0);
      expect(state.paths).toHaveLength(1);
      expect(state.paths[0]).toHaveLength(2);
      expect(state.paths[0]?.[0]).toEqual(start);
      expect(state.paths[0]?.[1]?.[0]).toBeCloseTo(midpointLongitude, 12);
      expect(state.paths[0]?.[1]?.[1]).toBe(0);
    },
  );
});
