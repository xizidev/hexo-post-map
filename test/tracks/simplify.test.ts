import { describe, expect, it } from 'vitest';

import { TrackBuildError } from '../../src/tracks/errors';
import { simplifyTrack } from '../../src/tracks/simplify';
import type { RawTrack, RawTrackPoint } from '../../src/tracks/types';

const point = (lon: number, lat = 0, elevationMeters?: number): RawTrackPoint => ({
  coordinate: [lon, lat],
  elevationMeters,
  timeMilliseconds: 1000,
});

describe('per-segment metre RDP', () => {
  it('drops collinear interior points and retains segment endpoints, elevation and order', () => {
    expect(
      simplifyTrack(
        [
          [point(0, 0, 2), point(0.001, 0, 10), point(0.002, 0, 3)],
          [point(10), point(10.001), point(10.002)],
        ],
        1,
        2000,
      ),
    ).toEqual([
      [
        [0, 0, 2],
        [0.002, 0, 3],
      ],
      [
        [10, 0],
        [10.002, 0],
      ],
    ]);
  });

  it('keeps an 11-metre bend above tolerance and removes it below the requested minimum', () => {
    const track = [[point(0), point(0.001, 0.0001), point(0.002)]];
    expect(simplifyTrack(track, 10, 2000)).toEqual([
      [
        [0, 0],
        [0.001, 0.0001],
        [0.002, 0],
      ],
    ]);
    expect(simplifyTrack(track, 12, 2000)).toEqual([
      [
        [0, 0],
        [0.002, 0],
      ],
    ]);
  });

  it('measures longitude at the segment latitude rather than treating degrees as metres', () => {
    // At 60 degrees N the 0.0001-degree longitudinal deviation is about 5.56 m.
    expect(
      simplifyTrack([[point(0, 60), point(0.0001, 60.001), point(0, 60.002)]], 6, 2000),
    ).toEqual([
      [
        [0, 60],
        [0, 60.002],
      ],
    ]);
  });

  it('unwraps the antimeridian within a segment while retaining original coordinates', () => {
    expect(simplifyTrack([[point(179.9), point(-180), point(-179.9)]], 1, 2000)).toEqual([
      [
        [179.9, 0],
        [-179.9, 0],
      ],
    ]);
  });

  it('preserves singleton and duplicate endpoints and deeply freezes copied output', () => {
    const track = [[point(0)], [point(1), point(1)]];
    const snapshot = JSON.stringify(track);
    const result = simplifyTrack(track, 0, 2000);
    expect(result).toEqual([
      [[0, 0]],
      [
        [1, 0],
        [1, 0],
      ],
    ]);
    expect(JSON.stringify(track)).toBe(snapshot);
    for (const value of [result, result[0], result[0]![0]])
      expect(Object.isFrozen(value)).toBe(true);
  });

  it('adaptively fits 1,000 three-point segments at a shared tolerance without losing endpoints', () => {
    const track: RawTrack = Array.from({ length: 1000 }, (_, index) => [
      point(index / 100),
      point(index / 100 + 0.001, 0.001),
      point(index / 100 + 0.002),
    ]);
    const result = simplifyTrack(track, 0, 2000);
    expect(result).toHaveLength(1000);
    expect(result.reduce((sum, segment) => sum + segment.length, 0)).toBe(2000);
    for (let index = 0; index < 1000; index++) {
      expect(result[index]).toEqual([
        [index / 100, 0],
        [index / 100 + 0.002, 0],
      ]);
    }
    expect(simplifyTrack(track, 0, 2000)).toEqual(result);
  });

  it('adaptively simplifies one long zigzag without recursion overflow', () => {
    const track = [
      Array.from({ length: 4001 }, (_, index) => point(index / 10000, (index % 2) / 10000)),
    ];
    const result = simplifyTrack(track, 0, 2000);
    expect(result[0]!.length).toBeLessThanOrEqual(2000);
    expect(result[0]![0]).toEqual([0, 0]);
    expect(result[0]!.at(-1)).toEqual([0.4, 0]);
  });

  it('rejects 1,001 two-point segments when endpoints alone exceed the cap', () => {
    const track = Array.from({ length: 1001 }, () => [point(0), point(0.001)]);
    expect(() => simplifyTrack(track, 0, 2000)).toThrow(TrackBuildError);
    expect(() => simplifyTrack(track, 0, 2000)).toThrow(/segment endpoints/);
  });
});
