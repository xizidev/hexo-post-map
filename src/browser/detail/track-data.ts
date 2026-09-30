import type {
  PublishedTrackAsset,
  PublishedTrackCoordinate,
  PublishedTrackSegments,
  TrackStats,
} from '../../tracks/types';

const ERROR_MESSAGE = 'Track data unavailable';
const MAXIMUM_POINTS = 2_000;
const ROOT_KEYS = new Set(['version', 'coordinateSystem', 'segments', 'stats']);
const STATISTIC_KEYS = new Set(['distanceMeters', 'elevationGainMeters', 'durationSeconds']);

function unavailable(): Error {
  return new Error(ERROR_MESSAGE);
}

function aborted(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw aborted();
}

function awaitWithAbort<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(aborted()));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    Promise.resolve(operation).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function readStats(value: unknown): TrackStats {
  if (!isRecord(value) || !hasOnlyKeys(value, STATISTIC_KEYS)) throw unavailable();
  if (!finiteNonNegative(value.distanceMeters)) throw unavailable();
  if (
    (value.elevationGainMeters !== undefined && !finiteNonNegative(value.elevationGainMeters)) ||
    (value.durationSeconds !== undefined && !finiteNonNegative(value.durationSeconds))
  ) {
    throw unavailable();
  }
  return Object.freeze({
    distanceMeters: value.distanceMeters,
    ...(value.elevationGainMeters === undefined
      ? {}
      : { elevationGainMeters: value.elevationGainMeters }),
    ...(value.durationSeconds === undefined ? {} : { durationSeconds: value.durationSeconds }),
  });
}

function readCoordinate(value: unknown): PublishedTrackCoordinate {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) throw unavailable();
  const [longitude, latitude, elevation] = value;
  if (
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    (value.length === 3 && (typeof elevation !== 'number' || !Number.isFinite(elevation)))
  ) {
    throw unavailable();
  }
  return Object.freeze(
    value.length === 3 ? [longitude, latitude, elevation as number] : [longitude, latitude],
  );
}

function readSegments(value: unknown): PublishedTrackSegments {
  if (!Array.isArray(value) || value.length === 0) throw unavailable();
  let count = 0;
  let usable = false;
  const segments = value.map((candidate): readonly PublishedTrackCoordinate[] => {
    if (!Array.isArray(candidate) || candidate.length === 0) throw unavailable();
    const segment = candidate.map((point) => {
      count += 1;
      if (count > MAXIMUM_POINTS) throw unavailable();
      return readCoordinate(point);
    });
    const first = segment[0]!;
    if (segment.some((point) => point[0] !== first[0] || point[1] !== first[1])) {
      usable = true;
    }
    return Object.freeze(segment);
  });
  if (!usable) throw unavailable();
  return Object.freeze(segments);
}

function readAsset(value: unknown): PublishedTrackAsset {
  if (!isRecord(value) || !hasOnlyKeys(value, ROOT_KEYS)) throw unavailable();
  if (value.version !== 1 || value.coordinateSystem !== 'wgs84') throw unavailable();
  return Object.freeze({
    version: 1,
    coordinateSystem: 'wgs84',
    segments: readSegments(value.segments),
    stats: readStats(value.stats),
  });
}

function isJsonMediaType(contentType: string | null): boolean {
  const essence = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  return (
    essence === 'application/json' ||
    /^application\/[!#$%&'*+.^_`|~0-9a-z-]+\+json$/.test(essence ?? '')
  );
}

/** Loads only same-origin, generated JSON and returns a detached immutable value. */
export async function loadTrackAsset(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<PublishedTrackAsset> {
  try {
    throwIfAborted(signal);
    const base = new URL(document.baseURI);
    const resolved = new URL(url, base);
    const documentOrigin = window.location.origin;
    if (documentOrigin === 'null' || resolved.origin !== documentOrigin) throw unavailable();
    const response = await awaitWithAbort(
      fetcher(resolved.href, { credentials: 'same-origin', signal }),
      signal,
    );
    throwIfAborted(signal);
    if (!response.ok || !isJsonMediaType(response.headers.get('content-type'))) {
      throw unavailable();
    }
    if (response.url && new URL(response.url, resolved).origin !== documentOrigin) {
      throw unavailable();
    }
    const value: unknown = await awaitWithAbort(response.json(), signal);
    throwIfAborted(signal);
    return readAsset(value);
  } catch {
    if (signal.aborted) throw aborted();
    throw unavailable();
  }
}
