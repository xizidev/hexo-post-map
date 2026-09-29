import { describe, expect, it } from 'vitest';
import { formatTrackStats } from '../../src/presentation/track';

describe('track statistic labels', () => {
  it.each([
    [0, '0 米'],
    [123.456, '123 米'],
    [999.4, '999 米'],
    [1000, '1.00 公里'],
    [12345.67, '12.35 公里'],
  ])('formats %s metres deterministically', (distanceMeters, value) => {
    expect(formatTrackStats({ distanceMeters })).toEqual([{ label: '距离', value }]);
  });

  it.each([
    [0, '0 分钟'],
    [90, '2 分钟'],
    [3540, '59 分钟'],
    [3600, '1 小时 0 分钟'],
    [5400, '1 小时 30 分钟'],
    [7199, '2 小时 0 分钟'],
  ])('formats %s seconds without locale dependencies', (durationSeconds, value) => {
    expect(formatTrackStats({ distanceMeters: 1, durationSeconds })).toEqual([
      { label: '距离', value: '1 米' },
      { label: '时长', value },
    ]);
  });

  it('includes optional zero elevation and duration instead of treating them as missing', () => {
    expect(
      formatTrackStats({ distanceMeters: 1234, elevationGainMeters: 0, durationSeconds: 0 }),
    ).toEqual([
      { label: '距离', value: '1.23 公里' },
      { label: '累计爬升', value: '0 米' },
      { label: '时长', value: '0 分钟' },
    ]);
    expect(formatTrackStats({ distanceMeters: 10, elevationGainMeters: 123.6 })).toEqual([
      { label: '距离', value: '10 米' },
      { label: '累计爬升', value: '124 米' },
    ]);
  });
});
