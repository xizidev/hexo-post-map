import { TrackBuildError } from './errors';
import type {
  PublishedTrackAsset,
  PublishedTrackCoordinate,
  PublishedTrackSegments,
  TrackStats,
} from './types';

function canonicalNumber(value: number, decimals: number): number {
  const rounded = Number(value.toFixed(decimals));
  if (!Number.isFinite(rounded))
    throw new TrackBuildError('track', 'non-finite published track number');
  return rounded === 0 ? 0 : rounded;
}

/** Whitelist and order every public key; source identity and timestamps cannot cross here. */
export function createTrackAsset(
  segments: PublishedTrackSegments,
  stats: TrackStats,
): PublishedTrackAsset {
  const publicSegments = Object.freeze(
    segments.map((segment) =>
      Object.freeze(
        segment.map((point): PublishedTrackCoordinate => {
          const longitude = canonicalNumber(point[0], 7);
          const latitude = canonicalNumber(point[1], 7);
          return Object.freeze(
            point.length === 3
              ? [longitude, latitude, canonicalNumber(point[2], 3)]
              : [longitude, latitude],
          );
        }),
      ),
    ),
  );
  if (
    !publicSegments.some((segment) =>
      segment.some((point) => point[0] !== segment[0]![0] || point[1] !== segment[0]![1]),
    )
  ) {
    throw new TrackBuildError('track', 'track has no usable geometry at published precision');
  }
  return Object.freeze({
    version: 1,
    coordinateSystem: 'wgs84',
    segments: publicSegments,
    stats: Object.freeze({
      distanceMeters: canonicalNumber(stats.distanceMeters, 3),
      ...(stats.elevationGainMeters === undefined
        ? {}
        : { elevationGainMeters: canonicalNumber(stats.elevationGainMeters, 3) }),
      ...(stats.durationSeconds === undefined
        ? {}
        : { durationSeconds: canonicalNumber(stats.durationSeconds, 3) }),
    }),
  });
}
