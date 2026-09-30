import { TrackBuildError } from './errors';
import type { RawTrack, RawTrackPoint } from './types';

export function invalidTrack(reason: string): never {
  throw new TrackBuildError('track', reason);
}

export function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return invalidTrack(`invalid ${field}`);
  }
  return value;
}

export function coordinate(longitude: unknown, latitude: unknown): RawTrackPoint['coordinate'] {
  const lon = finiteNumber(longitude, 'longitude');
  const lat = finiteNumber(latitude, 'latitude');
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    return invalidTrack('coordinate outside WGS84 bounds');
  }
  return [lon, lat];
}

export function enforcePointLimit(count: number): void {
  if (count > 200000) invalidTrack('track exceeds the 200,000 point limit');
}

export function validateRawTrack(segments: RawTrack): RawTrack {
  const nonempty = segments.filter((segment) => segment.length > 0);
  const usable = nonempty.some((segment) => {
    const first = segment[0]!;
    return segment.some(
      (point) =>
        point.coordinate[0] !== first.coordinate[0] || point.coordinate[1] !== first.coordinate[1],
    );
  });
  if (!usable) invalidTrack('track needs two distinct usable points in one segment');
  return nonempty;
}

export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return invalidTrack('track must contain valid UTF-8');
  }
}
