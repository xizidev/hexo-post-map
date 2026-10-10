import { postMapSchema } from '../domain/schema';
import type { Coordinate } from '../domain/types';
import { AUTHOR_MAX_POINTS, AUTHOR_MAX_ROUTE_STOPS } from './limits';
import {
  AuthorDraftError,
  type AuthorDraft,
  type AuthorIssue,
  type AuthorMapInput,
  type AuthorPointInput,
} from './types';

function fail(fieldPath: string, message: string): never {
  throw new AuthorDraftError([{ fieldPath, message }]);
}

function validateLimits(pointCount: number, stopCount: number): void {
  if (pointCount > AUTHOR_MAX_POINTS) {
    fail('map.points', `must contain at most ${AUTHOR_MAX_POINTS} points`);
  }
  if (stopCount > AUTHOR_MAX_ROUTE_STOPS) {
    fail('map.route', `must contain at most ${AUTHOR_MAX_ROUTE_STOPS} stops`);
  }
}

function validateMap(map: AuthorMapInput): void {
  validateLimits(map.points.length, map.route?.length ?? 0);
  const result = postMapSchema.safeParse(map);
  if (!result.success) {
    throw new AuthorDraftError(
      result.error.issues.map((issue) => ({
        fieldPath: issue.path.reduce<string>(
          (path, key) => (typeof key === 'number' ? `${path}[${key}]` : `${path}.${String(key)}`),
          'map',
        ),
        message: issue.message,
      })),
    );
  }
}

function validatePoint(input: AuthorPointInput, index: number, allowEmptyName: boolean): void {
  const issues: AuthorIssue[] = [];
  if (typeof input.name !== 'string' || (!allowEmptyName && input.name.trim().length === 0)) {
    issues.push({ fieldPath: `map.points[${index}].name`, message: 'must be a non-empty name' });
  }
  const coordinate: Coordinate = [input.longitude, input.latitude];
  for (const [axis, field, bound] of [
    [0, 'longitude', 180],
    [1, 'latitude', 90],
  ] as const) {
    const value = coordinate[axis];
    if (!Number.isFinite(value) || value < -bound || value > bound) {
      issues.push({
        fieldPath: `map.points[${index}].${field}`,
        message: `must be a finite number between ${-bound} and ${bound}`,
      });
    }
  }
  if (issues.length > 0) throw new AuthorDraftError(issues);
}

function pointIndex(draft: AuthorDraft, id: string, fieldPath = 'map.points'): number {
  const index = draft.points.findIndex((point) => point.id === id);
  if (index === -1) fail(fieldPath, 'must reference an existing point');
  return index;
}

export function createAuthorDraft(map?: AuthorMapInput): AuthorDraft {
  if (map !== undefined) validateMap(map);
  const imported = map === undefined ? undefined : structuredClone(map);
  return {
    points: imported?.points ?? [],
    representativeId: imported?.representative ?? imported?.points[0]?.id,
    representativeMode: imported?.representative === undefined ? 'implicit' : 'explicit',
    route: imported?.route ?? [],
    ...(imported?.zoom !== undefined ? { zoom: imported.zoom } : {}),
    ...(imported?.track !== undefined ? { track: imported.track } : {}),
    importedIds: imported?.points.map((point) => point.id) ?? [],
    nextPointOrdinal: 1,
    revision: 0,
  };
}

export function addAuthorPoint(draft: AuthorDraft, input: AuthorPointInput): AuthorDraft {
  validateLimits(draft.points.length + 1, draft.route.length);
  validatePoint(input, draft.points.length, false);
  const reserved = new Set([...draft.importedIds, ...draft.points.map((point) => point.id)]);
  let ordinal = draft.nextPointOrdinal;
  while (reserved.has(`point-${ordinal}`)) ordinal += 1;
  const id = `point-${ordinal}`;
  const representativeId =
    draft.representativeMode === 'pending' ? undefined : (draft.representativeId ?? id);
  const representativeMode =
    draft.representativeMode === 'implicit' && draft.points.length > 0
      ? 'explicit'
      : draft.representativeMode;
  return {
    ...draft,
    points: [
      ...draft.points,
      { id, name: input.name, longitude: input.longitude, latitude: input.latitude },
    ],
    representativeId,
    representativeMode,
    nextPointOrdinal: ordinal + 1,
    revision: draft.revision + 1,
  };
}

export function updateAuthorPoint(
  draft: AuthorDraft,
  id: string,
  patch: Partial<AuthorPointInput>,
): AuthorDraft {
  const index = pointIndex(draft, id);
  const before = draft.points[index]!;
  const point = {
    id: before.id,
    name: 'name' in patch ? patch.name! : before.name,
    longitude: 'longitude' in patch ? patch.longitude! : before.longitude,
    latitude: 'latitude' in patch ? patch.latitude! : before.latitude,
  };
  validatePoint(point, index, true);
  if (
    point.name === before.name &&
    Object.is(point.longitude, before.longitude) &&
    Object.is(point.latitude, before.latitude)
  )
    return draft;
  const points = [...draft.points];
  points[index] = point;
  return { ...draft, points, revision: draft.revision + 1 };
}

export function moveAuthorPoint(
  draft: AuthorDraft,
  id: string,
  direction: 'up' | 'down',
): AuthorDraft {
  const index = pointIndex(draft, id);
  const target = index + (direction === 'up' ? -1 : 1);
  if (target < 0 || target >= draft.points.length) return draft;
  const points = [...draft.points];
  [points[index], points[target]] = [points[target]!, points[index]!];
  return { ...draft, points, revision: draft.revision + 1 };
}

export function selectAuthorRepresentative(draft: AuthorDraft, id: string): AuthorDraft {
  pointIndex(draft, id, 'map.representative');
  if (draft.representativeId === id && draft.representativeMode === 'explicit') return draft;
  return {
    ...draft,
    representativeId: id,
    representativeMode: 'explicit',
    revision: draft.revision + 1,
  };
}

export function deleteAuthorPoint(draft: AuthorDraft, id: string): AuthorDraft {
  pointIndex(draft, id);
  const deletedRepresentative = draft.representativeId === id;
  return {
    ...draft,
    points: draft.points.filter((point) => point.id !== id),
    route: draft.route.filter((stop) => stop !== id),
    representativeId: deletedRepresentative ? undefined : draft.representativeId,
    representativeMode: deletedRepresentative ? 'pending' : draft.representativeMode,
    revision: draft.revision + 1,
  };
}

export function setAuthorRoute(draft: AuthorDraft, ids: readonly string[]): AuthorDraft {
  validateLimits(draft.points.length, ids.length);
  ids.forEach((id, index) => pointIndex(draft, id, `map.route[${index}]`));
  if (ids.length === draft.route.length && ids.every((id, index) => id === draft.route[index])) {
    return draft;
  }
  return { ...draft, route: [...ids], revision: draft.revision + 1 };
}

export function setAuthorZoom(draft: AuthorDraft, zoom: number | undefined): AuthorDraft {
  if (zoom !== undefined && (!Number.isFinite(zoom) || zoom < 2 || zoom > 20)) {
    fail('map.zoom', 'must be a finite number between 2 and 20');
  }
  if (Object.is(draft.zoom, zoom)) return draft;
  return { ...draft, zoom, revision: draft.revision + 1 };
}

export function draftMapInput(draft: AuthorDraft): AuthorMapInput {
  if (draft.representativeMode === 'pending') {
    fail('map.representative', 'must explicitly select a representative point');
  }
  const map: AuthorMapInput = {
    points: draft.points.map((point) => ({ ...point })),
    ...(draft.representativeMode === 'explicit' ? { representative: draft.representativeId } : {}),
    ...(draft.route.length > 0 ? { route: [...draft.route] } : {}),
    ...(draft.zoom !== undefined ? { zoom: draft.zoom } : {}),
    ...(draft.track !== undefined ? { track: structuredClone(draft.track) } : {}),
  };
  validateMap(map);
  return map;
}
