import { TrackBuildError } from './errors';
import { clamp, earthRadiusMeters, radiansPerDegree } from './geo';
import type {
  PublishedTrackCoordinate,
  PublishedTrackSegments,
  RawTrack,
  RawTrackPoint,
} from './types';

type XY = readonly [number, number];

function project(segment: readonly RawTrackPoint[]): XY[] {
  const origin = segment[0]!.coordinate;
  const scale = earthRadiusMeters * radiansPerDegree;
  const longitudeScale = scale * Math.cos(origin[1] * radiansPerDegree);
  let longitude = 0;
  return segment.map((point, index) => {
    if (index > 0) {
      const delta = point.coordinate[0] - segment[index - 1]!.coordinate[0];
      longitude += delta > 180 ? delta - 360 : delta < -180 ? delta + 360 : delta;
    }
    return [longitude * longitudeScale, (point.coordinate[1] - origin[1]) * scale];
  });
}

function squaredDistance(point: XY, start: XY, end: XY): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = dx * dx + dy * dy;
  const ratio =
    length === 0
      ? 0
      : clamp(((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length, 0, 1);
  return (point[0] - start[0] - ratio * dx) ** 2 + (point[1] - start[1] - ratio * dy) ** 2;
}

/** Stop unsuccessful trials early; an explicit stack handles long source segments. */
function retainedIndices(
  points: readonly XY[],
  tolerance: number,
  budget: { remaining: number },
): number[] | undefined {
  const last = points.length - 1;
  const retained = new Set([0, last]);
  const stack: [number, number][] = [[0, last]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maximum = tolerance * tolerance;
    let split = -1;
    for (let index = start + 1; index < end; index++) {
      const distance = squaredDistance(points[index]!, points[start]!, points[end]!);
      // Strict greater-than means the earliest source point wins a tie.
      if (distance > maximum) {
        maximum = distance;
        split = index;
      }
    }
    if (split < 0) continue;
    if (--budget.remaining < 0) return undefined;
    retained.add(split);
    stack.push([split, end], [start, split]);
  }
  return [...retained].sort((a, b) => a - b);
}

export function simplifyTrack(
  track: RawTrack,
  minimumToleranceMeters: number,
  maximumPoints: number,
): PublishedTrackSegments {
  const segments = track.filter((segment) => segment.length);
  const endpointCount = segments.reduce((sum, segment) => sum + Math.min(2, segment.length), 0);
  if (endpointCount > maximumPoints) {
    throw new TrackBuildError(
      'track',
      'segment endpoints exceed the published point limit',
      'map.track.source',
    );
  }
  const projected = segments.map(project);
  let tolerance = minimumToleranceMeters;
  for (;;) {
    const budget = { remaining: maximumPoints - endpointCount };
    const indices: number[][] = [];
    for (const points of projected) {
      const retained = retainedIndices(points, tolerance, budget);
      if (!retained) break;
      indices.push(retained);
    }
    if (indices.length === segments.length) {
      return Object.freeze(
        indices.map((retained, segmentIndex) =>
          Object.freeze(
            retained.map((index): PublishedTrackCoordinate => {
              const point = segments[segmentIndex]![index]!;
              return Object.freeze(
                point.elevationMeters === undefined
                  ? [point.coordinate[0], point.coordinate[1]]
                  : [point.coordinate[0], point.coordinate[1], point.elevationMeters],
              );
            }),
          ),
        ),
      );
    }
    tolerance = tolerance === 0 ? 1 : tolerance * 2;
  }
}
