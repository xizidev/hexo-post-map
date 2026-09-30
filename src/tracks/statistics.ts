import { haversineMeters } from './geo';
import type { RawTrack, TrackStats } from './types';

/** Public statistics use millimetres / milliseconds; toFixed avoids scaling overflow. */
export function roundStatistic(value: number): number {
  return Number(value.toFixed(3));
}

export function calculateTrackStats(track: RawTrack): TrackStats {
  let distance = 0;
  let gain = 0;
  let duration = 0;
  let completeElevation = true;
  let completeTime = true;
  for (const segment of track) {
    for (let index = 0; index < segment.length; index++) {
      const point = segment[index]!;
      completeElevation &&= Number.isFinite(point.elevationMeters);
      completeTime &&= Number.isFinite(point.timeMilliseconds);
      if (index === 0) continue;
      const previous = segment[index - 1]!;
      distance += haversineMeters(previous.coordinate, point.coordinate);
      if (completeElevation)
        gain += Math.max(0, point.elevationMeters! - previous.elevationMeters!);
      if (completeTime && point.timeMilliseconds! < previous.timeMilliseconds!)
        completeTime = false;
    }
    if (completeTime && segment.length) {
      duration +=
        (segment[segment.length - 1]!.timeMilliseconds! - segment[0]!.timeMilliseconds!) / 1000;
    }
  }
  return Object.freeze({
    distanceMeters: roundStatistic(distance),
    ...(completeElevation && Number.isFinite(gain)
      ? { elevationGainMeters: roundStatistic(gain) }
      : {}),
    ...(completeTime && Number.isFinite(duration)
      ? { durationSeconds: roundStatistic(duration) }
      : {}),
  });
}
