import type { Coordinate } from '../../domain/types';
import { haversineMeters } from '../../tracks/geo';
import type { PublishedTrackAsset } from '../../tracks/types';

const CONVERSION_BATCH_SIZE = 40;
const CONVERSION_TIMEOUT_MILLISECONDS = 20_000;
const CONVERSION_ERROR = 'Track coordinate conversion failed';

interface AMapConversionResult {
  readonly locations?: unknown;
}

export interface AMapTrackConversionApi {
  convertFrom(
    coordinates: readonly Coordinate[],
    source: 'gps',
    callback: (status: string, result?: AMapConversionResult) => void,
  ): void;
}

export interface ConvertedTrack {
  readonly segments: readonly (readonly Coordinate[])[];
}

export interface TrackProgressState {
  readonly paths: readonly (readonly Coordinate[])[];
  readonly coordinate: Coordinate;
}

export interface TrackProgressGeometry {
  readonly totalDistanceMeters: number;
  at(progress: number): TrackProgressState;
}

export interface TrackConversionOptions {
  /** Internal adapter seam: one mount deadline can own conversion and map readiness. */
  readonly timeoutMilliseconds?: number | false;
}

function aborted(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function failed(): Error {
  return new Error(CONVERSION_ERROR);
}

function convertedCoordinate(value: unknown): Coordinate {
  let longitude: unknown;
  let latitude: unknown;
  if (Array.isArray(value)) {
    [longitude, latitude] = value;
  } else if (typeof value === 'object' && value !== null) {
    const candidate = value as { getLng?: unknown; getLat?: unknown };
    if (typeof candidate.getLng !== 'function' || typeof candidate.getLat !== 'function') {
      throw failed();
    }
    longitude = candidate.getLng.call(value);
    latitude = candidate.getLat.call(value);
  }
  if (
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw failed();
  }
  return Object.freeze([longitude, latitude]);
}

/** Converts one validated WGS84 asset without ever returning a partially converted track. */
export function convertTrackFromGps(
  api: AMapTrackConversionApi,
  track: PublishedTrackAsset,
  signal: AbortSignal,
  options: TrackConversionOptions = {},
): Promise<ConvertedTrack> {
  if (signal.aborted) return Promise.reject(aborted());
  const lengths = track.segments.map((segment) => segment.length);
  const source = track.segments.flatMap((segment) =>
    segment.map(([longitude, latitude]): Coordinate => [longitude, latitude]),
  );
  if (!source.length) return Promise.reject(failed());

  return new Promise((resolve, reject) => {
    let settled = false;
    let callbackGeneration = 0;
    const converted: Coordinate[] = [];
    const timeoutMilliseconds = options.timeoutMilliseconds ?? CONVERSION_TIMEOUT_MILLISECONDS;
    const timer =
      timeoutMilliseconds === false
        ? undefined
        : window.setTimeout(
            () => finish(() => reject(new Error('Track coordinate conversion timed out'))),
            timeoutMilliseconds,
          );

    function release(): void {
      if (timer !== undefined) window.clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }

    function finish(settle: () => void): void {
      if (settled) return;
      settled = true;
      callbackGeneration += 1;
      release();
      settle();
    }

    function onAbort(): void {
      finish(() => reject(aborted()));
    }

    function complete(): void {
      let offset = 0;
      const segments = lengths.map((length) => {
        const segment = Object.freeze(converted.slice(offset, offset + length));
        offset += length;
        return segment;
      });
      finish(() => resolve(Object.freeze({ segments: Object.freeze(segments) })));
    }

    function next(offset: number): void {
      if (settled) return;
      if (offset >= source.length) {
        complete();
        return;
      }
      const batch = source.slice(offset, offset + CONVERSION_BATCH_SIZE);
      const generation = ++callbackGeneration;
      try {
        api.convertFrom(batch, 'gps', (status, result) => {
          if (settled || generation !== callbackGeneration) return;
          try {
            if (status !== 'complete' || !Array.isArray(result?.locations)) throw failed();
            if (result.locations.length !== batch.length) throw failed();
            for (let index = 0; index < batch.length; index += 1) {
              if (!Object.prototype.hasOwnProperty.call(result.locations, index)) throw failed();
              converted.push(convertedCoordinate(result.locations[index]));
            }
            next(offset + batch.length);
          } catch {
            finish(() => reject(failed()));
          }
        });
      } catch {
        finish(() => reject(failed()));
      }
    }

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    else next(0);
  });
}

function interpolateCoordinate(start: Coordinate, end: Coordinate, fraction: number): Coordinate {
  const directLongitudeDelta = end[0] - start[0];
  const shortestLongitudeDelta =
    directLongitudeDelta > 180
      ? directLongitudeDelta - 360
      : directLongitudeDelta < -180
        ? directLongitudeDelta + 360
        : directLongitudeDelta;
  const unwrappedLongitude = start[0] + shortestLongitudeDelta * fraction;
  const longitude =
    unwrappedLongitude > 180
      ? unwrappedLongitude - 360
      : unwrappedLongitude < -180
        ? unwrappedLongitude + 360
        : unwrappedLongitude;
  return Object.freeze([longitude, start[1] + (end[1] - start[1]) * fraction]);
}

function safeProgress(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Precomputes edge lengths once and produces segment-safe progress paths on demand. */
export function createTrackProgressGeometry(track: ConvertedTrack): TrackProgressGeometry {
  const segmentDistances = track.segments.map((segment) =>
    segment.slice(1).map((coordinate, index) => haversineMeters(segment[index]!, coordinate)),
  );
  const totals = segmentDistances.map((distances) =>
    distances.reduce((sum, distance) => sum + distance, 0),
  );
  const totalDistanceMeters = totals.reduce((sum, distance) => sum + distance, 0);
  const firstSegmentIndex = track.segments.findIndex((segment) => segment.length > 0);
  if (firstSegmentIndex < 0) throw new Error('Missing converted track coordinates');
  const first: Coordinate = track.segments[firstSegmentIndex]![0]!;
  let last = first;
  for (const segment of track.segments) {
    if (segment.length) last = segment[segment.length - 1]!;
  }

  function at(value: number): TrackProgressState {
    const progress = safeProgress(value);
    const paths: Coordinate[][] = track.segments.map(() => []);
    if (progress === 0) {
      paths[firstSegmentIndex]!.push(first);
      return { paths, coordinate: first };
    }
    if (progress === 1 || totalDistanceMeters === 0) {
      const completePaths = track.segments.map((segment) => [...segment]);
      return { paths: completePaths, coordinate: last };
    }

    let remaining = totalDistanceMeters * progress;
    let current = first;
    for (let segmentIndex = 0; segmentIndex < track.segments.length; segmentIndex += 1) {
      const segment = track.segments[segmentIndex]!;
      const segmentDistance = totals[segmentIndex]!;
      if (!segment.length) continue;
      if (segmentDistance === 0 && remaining > 0) {
        paths[segmentIndex]!.push(...segment);
        current = segment.at(-1)!;
        continue;
      }
      if (remaining >= segmentDistance) {
        paths[segmentIndex]!.push(...segment);
        current = segment.at(-1)!;
        remaining -= segmentDistance;
        if (remaining <= Number.EPSILON) break;
        continue;
      }

      const path = paths[segmentIndex]!;
      path.push(segment[0]!);
      const distances = segmentDistances[segmentIndex]!;
      for (let edgeIndex = 0; edgeIndex < distances.length; edgeIndex += 1) {
        const edgeDistance = distances[edgeIndex]!;
        const end = segment[edgeIndex + 1]!;
        if (edgeDistance === 0) {
          path.push(end);
          current = end;
          continue;
        }
        if (remaining >= edgeDistance) {
          path.push(end);
          current = end;
          remaining -= edgeDistance;
          if (remaining <= Number.EPSILON) break;
          continue;
        }
        current = interpolateCoordinate(segment[edgeIndex]!, end, remaining / edgeDistance);
        path.push(current);
        remaining = 0;
        break;
      }
      break;
    }
    return { paths, coordinate: current };
  }

  return Object.freeze({ totalDistanceMeters, at });
}
