import { TrackBuildError } from './errors';
import { haversineMeters, interpolatePoint } from './geo';
import type { RawTrack, RawTrackPoint } from './types';

function trimFront(track: RawTrack, meters: number): RawTrack {
  if (meters === 0) return track;
  for (let segmentIndex = 0; segmentIndex < track.length; segmentIndex++) {
    const segment = track[segmentIndex]!;
    for (let index = 1; index < segment.length; index++) {
      const previous = segment[index - 1]!;
      const current = segment[index]!;
      const distance = haversineMeters(previous.coordinate, current.coordinate);
      if (meters < distance) {
        return [
          [interpolatePoint(previous, current, meters / distance), ...segment.slice(index)],
          ...track.slice(segmentIndex + 1),
        ];
      }
      meters -= distance;
      if (meters === 0) {
        // A segment consumed to its last point contributes no remaining route.
        return index === segment.length - 1
          ? track.slice(segmentIndex + 1)
          : [segment.slice(index), ...track.slice(segmentIndex + 1)];
      }
    }
  }
  return [];
}

function reverseTrack(track: RawTrack): RawTrack {
  return [...track].reverse().map((segment) => [...segment].reverse());
}

function freezePoint(point: RawTrackPoint): RawTrackPoint {
  return Object.freeze({
    coordinate: Object.freeze([...point.coordinate]) as RawTrackPoint['coordinate'],
    ...(point.elevationMeters === undefined ? {} : { elevationMeters: point.elevationMeters }),
    ...(point.timeMilliseconds === undefined ? {} : { timeMilliseconds: point.timeMilliseconds }),
  });
}

export function trimTrack(track: RawTrack, startMeters: number, endMeters: number): RawTrack {
  const trimmed = reverseTrack(trimFront(reverseTrack(trimFront(track, startMeters)), endMeters));
  const usable = trimmed.some((segment) =>
    segment.some(
      (point, index) =>
        index > 0 && haversineMeters(segment[index - 1]!.coordinate, point.coordinate) > 0,
    ),
  );
  if (!usable) {
    throw new TrackBuildError(
      'track',
      'privacy trims consume the complete usable route',
      'map.track.privacy',
    );
  }
  return Object.freeze(trimmed.map((segment) => Object.freeze(segment.map(freezePoint))));
}
