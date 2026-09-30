import { describe, expect, it } from 'vitest';

import { trimTrack } from '../../src/tracks/privacy';
import { calculateTrackStats } from '../../src/tracks/statistics';
import type { RawTrackPoint } from '../../src/tracks/types';

const point = (
  lon: number,
  elevationMeters?: number,
  timeMilliseconds?: number,
): RawTrackPoint => ({
  coordinate: [lon, 0],
  elevationMeters,
  timeMilliseconds,
});

describe('trimmed unsimplified statistics', () => {
  it('sums only segment edges, positive elevation changes, and segment durations', () => {
    const stats = calculateTrackStats([
      [point(0, 0, 0), point(0.001, 10, 2000), point(0.002, 5, 3000)],
      [point(40, 100, 100000), point(40.001, 120, 105000)],
    ]);
    expect(stats).toEqual({ distanceMeters: 333.585, elevationGainMeters: 30, durationSeconds: 8 });
    expect(Object.isFrozen(stats)).toBe(true);
  });

  it('uses interpolation-created boundaries, excluding removed distance, gain and time', () => {
    const trimmed = trimTrack(
      [[point(0, 0, 0), point(1, 20, 2000), point(2, 0, 4000)]],
      111195.0802335329 / 2,
      111195.0802335329 / 4,
    );
    expect(calculateTrackStats(trimmed)).toEqual({
      distanceMeters: 138993.85,
      elevationGainMeters: 10,
      durationSeconds: 2.5,
    });
  });

  it('preserves sub-second durations and allows equal timestamps and segment time resets', () => {
    expect(
      calculateTrackStats([
        [point(0, 0, 1000), point(0.001, 0, 1125), point(0.002, 0, 1125)],
        [point(10, 0, 0), point(10.001, 0, 250)],
      ]),
    ).toEqual({ distanceMeters: 333.585, elevationGainMeters: 0, durationSeconds: 0.375 });
  });

  it.each([undefined, NaN, Infinity, -Infinity])(
    'omits all elevation gain for an incomplete/non-finite value: %s',
    (value) => {
      const stats = calculateTrackStats([
        [point(0, 0, 0), point(0.001, value, 1000), point(0.002, 20, 2000)],
      ]);
      expect(stats).toEqual({ distanceMeters: 222.39, durationSeconds: 2 });
    },
  );

  it.each([undefined, NaN, Infinity, -Infinity, -1000])(
    'omits duration for a missing/non-finite/decreasing timestamp: %s',
    (value) => {
      const stats = calculateTrackStats([
        [point(0, 0, 0), point(0.001, 10, value), point(0.002, 20, 2000)],
      ]);
      expect(stats).toEqual({ distanceMeters: 222.39, elevationGainMeters: 20 });
    },
  );

  it('does not hide an interior time decrease behind valid segment endpoints', () => {
    expect(
      calculateTrackStats([[point(0, 0, 0), point(0.001, 10, 3000), point(0.002, 20, 2000)]]),
    ).not.toHaveProperty('durationSeconds');
  });

  it('requires completeness across different segments, including singleton segments', () => {
    expect(calculateTrackStats([[point(0, 0, 0), point(0.001, 10, 1000)], [point(20)]])).toEqual({
      distanceMeters: 111.195,
    });
    expect(
      calculateTrackStats([
        [point(0, 0), point(0.001, 10)],
        [point(20, undefined, 1000), point(20.001, undefined, 2000)],
      ]),
    ).toEqual({ distanceMeters: 222.39 });
  });

  it('omits elevation gain if otherwise finite input values overflow during accumulation', () => {
    expect(calculateTrackStats([[point(0, -1e308), point(0.001, 1e308)]])).toEqual({
      distanceMeters: 111.195,
    });
  });
});
