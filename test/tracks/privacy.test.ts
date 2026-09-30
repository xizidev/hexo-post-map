import { describe, expect, it } from 'vitest';

import { TrackBuildError } from '../../src/tracks/errors';
import { haversineMeters, interpolatePoint } from '../../src/tracks/geo';
import { trimTrack } from '../../src/tracks/privacy';
import { calculateTrackStats } from '../../src/tracks/statistics';
import type { RawTrack, RawTrackPoint } from '../../src/tracks/types';

// Mean-earth radius 6,371,008.8 m gives this independently calculated equatorial degree.
const degree = 111195.0802335329;
const point = (
  lon: number,
  elevationMeters?: number,
  timeMilliseconds?: number,
): RawTrackPoint => ({
  coordinate: [lon, 0],
  ...(elevationMeters === undefined ? {} : { elevationMeters }),
  ...(timeMilliseconds === undefined ? {} : { timeMilliseconds }),
});

describe('Haversine metres', () => {
  it('measures short equatorial and meridian edges and handles antipodes', () => {
    expect(haversineMeters([0, 0], [0.001, 0])).toBeCloseTo(111.1950802, 6);
    expect(haversineMeters([0, 0], [0, 0.001])).toBeCloseTo(111.1950802, 6);
    expect(haversineMeters([0, 0], [180, 0])).toBeCloseTo(20015114.442, 2);
    expect(haversineMeters([1, 2], [1, 2])).toBe(0);
  });
});

describe('privacy trim', () => {
  it.each([1, -1])('cuts the start across the antimeridian in direction %s', (direction) => {
    // A 0.2-degree equatorial crossing is 22,239.01604670658 m; half is 0.1 degree.
    const output = trimTrack(
      [[point(direction * 179.9, 10, 1000), point(direction * -179.9, 30, 3000)]],
      11119.50802335329,
      0,
    );
    expect(output[0]).toHaveLength(2);
    expect(Math.abs(output[0]![0]!.coordinate[0])).toBeCloseTo(180, 9);
    expect(output[0]![1]!.coordinate[0]).toBe(direction * -179.9);
    expect(output[0]![0]!.elevationMeters).toBeCloseTo(20, 9);
    expect(output[0]![0]!.timeMilliseconds).toBeCloseTo(2000, 6);
    expect(calculateTrackStats(output)).toEqual({
      distanceMeters: 11119.508,
      elevationGainMeters: 10,
      durationSeconds: 1,
    });
  });

  it.each([1, -1])('cuts the end across the antimeridian in direction %s', (direction) => {
    const output = trimTrack(
      [[point(direction * 179.9, 10, 1000), point(direction * -179.9, 30, 3000)]],
      0,
      11119.50802335329,
    );
    expect(output[0]).toHaveLength(2);
    expect(output[0]![0]!.coordinate[0]).toBe(direction * 179.9);
    expect(Math.abs(output[0]![1]!.coordinate[0])).toBeCloseTo(180, 9);
    expect(output[0]![1]!.elevationMeters).toBeCloseTo(20, 9);
    expect(output[0]![1]!.timeMilliseconds).toBeCloseTo(2000, 6);
    expect(calculateTrackStats(output)).toEqual({
      distanceMeters: 11119.508,
      elevationGainMeters: 10,
      durationSeconds: 1,
    });
  });

  it.each([1, -1])('cuts both ends across the antimeridian in direction %s', (direction) => {
    // Removing 0.05 degrees at each end retains the middle 0.1-degree crossing.
    const output = trimTrack(
      [[point(direction * 179.9, 10, 1000), point(direction * -179.9, 30, 3000)]],
      5559.754011676645,
      5559.754011676645,
    );
    expect(output[0]).toHaveLength(2);
    expect(output[0]![0]!.coordinate[0]).toBeCloseTo(direction * 179.95, 9);
    expect(output[0]![1]!.coordinate[0]).toBeCloseTo(direction * -179.95, 9);
    expect(output[0]![0]!.elevationMeters).toBeCloseTo(15, 9);
    expect(output[0]![1]!.elevationMeters).toBeCloseTo(25, 9);
    expect(output[0]![0]!.timeMilliseconds).toBeCloseTo(1500, 6);
    expect(output[0]![1]!.timeMilliseconds).toBeCloseTo(2500, 6);
    expect(calculateTrackStats(output)).toEqual({
      distanceMeters: 11119.508,
      elevationGainMeters: 10,
      durationSeconds: 1,
    });
  });

  it.each([
    [180, -179.8, -179.9],
    [-180, 179.8, 179.9],
    [179.8, -180, 179.9],
    [-179.8, 180, -179.9],
    [180, -180, 180],
    [-180, 180, -180],
  ])('interpolates exact antimeridian endpoint %s → %s within WGS84', (start, end, expected) => {
    const output = interpolatePoint(point(start, 10, 1000), point(end, 30, 3000), 0.5);
    expect(output.coordinate[0]).toBeCloseTo(expected, 9);
    expect(output.coordinate[0]).toBeGreaterThanOrEqual(-180);
    expect(output.coordinate[0]).toBeLessThanOrEqual(180);
    expect(output.elevationMeters).toBe(20);
    expect(output.timeMilliseconds).toBe(2000);
  });

  it.each([
    [179.9, -179.9],
    [-179.9, 179.9],
    [180, -180],
    [-180, 180],
  ])('preserves exact coordinates at interpolation ratios zero and one: %s → %s', (start, end) => {
    expect(interpolatePoint(point(start, 10, 1000), point(end, 30, 3000), 0)).toEqual(
      point(start, 10, 1000),
    );
    expect(interpolatePoint(point(start, 10, 1000), point(end, 30, 3000), 1)).toEqual(
      point(end, 30, 3000),
    );
  });

  it('copies and deeply freezes every level even with zero trims', () => {
    const input: RawTrack = [[point(0, 2, 10), point(1, 3, 20)]];
    const output = trimTrack(input, 0, 0);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(output[0]).not.toBe(input[0]);
    expect(output[0]![0]).not.toBe(input[0]![0]);
    expect(output[0]![0]!.coordinate).not.toBe(input[0]![0]!.coordinate);
    for (const value of [output, output[0], output[0]![0], output[0]![0]!.coordinate]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(Object.isFrozen(input)).toBe(false);
  });

  it('cuts inside both edges and interpolates complete optional series', () => {
    const output = trimTrack(
      [[point(0, 0, 0), point(1, 20, 2000), point(2, 0, 4000)]],
      degree / 2,
      degree / 4,
    );
    expect(output[0]).toHaveLength(3);
    expect(output[0]![0]!.coordinate[0]).toBeCloseTo(0.5, 12);
    expect(output[0]![0]!.elevationMeters).toBeCloseTo(10, 12);
    expect(output[0]![0]!.timeMilliseconds).toBeCloseTo(1000, 9);
    expect(output[0]![2]!.coordinate[0]).toBeCloseTo(1.75, 12);
    expect(output[0]![2]!.elevationMeters).toBeCloseTo(5, 12);
    expect(output[0]![2]!.timeMilliseconds).toBeCloseTo(3500, 9);
  });

  it('walks across whole segments without charging gaps and keeps their order', () => {
    const output = trimTrack(
      [
        [point(0), point(1)],
        [point(20), point(22)],
        [point(80), point(81)],
      ],
      degree * 1.5,
      degree * 1.5,
    );
    expect(output).toHaveLength(1);
    expect(output[0]).toHaveLength(2);
    expect(output[0]![0]!.coordinate[0]).toBeCloseTo(20.5, 12);
    expect(output[0]![1]!.coordinate[0]).toBeCloseTo(21.5, 12);
  });

  it('removes a fully consumed segment at an exact edge boundary', () => {
    expect(
      trimTrack(
        [
          [point(0), point(1)],
          [point(20), point(21)],
        ],
        degree,
        0,
      ),
    ).toEqual([[point(20), point(21)]]);
  });

  it('only interpolates optional values supplied by both endpoints', () => {
    const output = trimTrack(
      [[point(0, 10), point(1, undefined, 2000), point(2, 30)]],
      degree / 2,
      degree / 2,
    );
    expect(output[0]![0]).not.toHaveProperty('elevationMeters');
    expect(output[0]![0]).not.toHaveProperty('timeMilliseconds');
    expect(output[0]![2]).not.toHaveProperty('elevationMeters');
    expect(output[0]![2]).not.toHaveProperty('timeMilliseconds');
  });

  it('does not mutate inputs and skips duplicate edges while consuming distance', () => {
    const input = [[point(0), point(0), point(1), point(2)]];
    const snapshot = JSON.stringify(input);
    const output = trimTrack(input, degree / 2, 0);
    expect(output[0]).toHaveLength(3);
    expect(output[0]![0]!.coordinate[0]).toBeCloseTo(0.5, 12);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it.each([
    [degree * 2, 0],
    [0, degree * 2],
    [degree, degree],
    [degree * 3, 0],
  ])('rejects complete consumption with a privacy field (%s, %s)', (start, end) => {
    try {
      trimTrack([[point(0), point(1), point(2)]], start, end);
      expect.fail('expected privacy failure');
    } catch (error) {
      expect(error).toBeInstanceOf(TrackBuildError);
      expect((error as TrackBuildError).fieldPath).toBe('map.track.privacy');
    }
  });
});
