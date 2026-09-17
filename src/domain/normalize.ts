import { ZodError } from 'zod';

import { PostMapValidationError } from './errors';
import { postMapSchema, type ParsedPostMap } from './schema';
import type { Coordinate, NormalizedPoint, NormalizedPostMap } from './types';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }

  return value;
}

function getValueAtPath(value: unknown, path: readonly PropertyKey[]): unknown {
  let current = value;

  for (const segment of path) {
    if (
      current === null ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined;
    }
    current = (current as Record<PropertyKey, unknown>)[segment];
  }

  return current;
}

function formatFieldPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return 'map';
  }

  return `map${path
    .map((segment) => (typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`))
    .join('')}`;
}

function toValidationError(
  error: ZodError,
  raw: unknown,
  sourcePath: string,
): PostMapValidationError {
  const issue = error.issues[0];

  if (issue === undefined) {
    return new PostMapValidationError(sourcePath, 'map', raw, 'is invalid');
  }

  return new PostMapValidationError(
    sourcePath,
    formatFieldPath(issue.path),
    getValueAtPath(raw, issue.path),
    issue.message,
  );
}

function normalizePoint(point: ParsedPostMap['points'][number]): NormalizedPoint {
  const coordinate: Coordinate = [point.longitude, point.latitude];

  return { id: point.id, name: point.name, coordinate };
}

export function normalizePostMap(raw: unknown, sourcePath: string): NormalizedPostMap | null {
  if (raw === undefined) {
    return null;
  }

  const result = postMapSchema.safeParse(raw);
  if (!result.success) {
    throw toValidationError(result.error, raw, sourcePath);
  }

  const points = result.data.points.map(normalizePoint);
  const pointsById = new Map(points.map((point) => [point.id, point]));
  const representativeIdentifier = result.data.representative ?? points[0]?.id;

  if (representativeIdentifier === undefined) {
    throw new PostMapValidationError(
      sourcePath,
      'map.points',
      raw,
      'must contain at least one point',
    );
  }

  const representative = pointsById.get(representativeIdentifier);
  if (representative === undefined) {
    throw new PostMapValidationError(
      sourcePath,
      'map.representative',
      representativeIdentifier,
      `point "${representativeIdentifier}" does not exist in map.points`,
    );
  }

  const route = (result.data.route ?? []).map((identifier) => pointsById.get(identifier));
  if (route.some((point) => point === undefined)) {
    throw new PostMapValidationError(
      sourcePath,
      'map.route',
      result.data.route,
      'references an unknown point',
    );
  }

  const normalized: NormalizedPostMap = {
    points,
    representative,
    route: route as NormalizedPoint[],
    ...(result.data.zoom === undefined ? {} : { zoom: result.data.zoom }),
  };

  return deepFreeze(normalized);
}
