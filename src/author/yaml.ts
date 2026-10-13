import {
  isAlias,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  stringify,
} from 'yaml';

import { normalizePostMapDocument } from '../domain/normalize';
import { postMapSchema } from '../domain/schema';
import { draftMapInput } from './draft';
import {
  AUTHOR_MAX_ALIAS_COUNT,
  AUTHOR_MAX_POINTS,
  AUTHOR_MAX_ROUTE_STOPS,
  AUTHOR_MAX_YAML_BYTES,
} from './limits';
import { AuthorDraftError, type AuthorDraft, type AuthorIssue, type AuthorMapInput } from './types';

export type AuthorImportResult =
  { ok: true; map: AuthorMapInput } | { ok: false; issues: readonly AuthorIssue[] };

export type AuthorExportResult =
  | { ok: true; yaml: string; map: AuthorMapInput; revision: number }
  | { ok: false; issues: readonly AuthorIssue[] };

const safeFields = new Set([
  'map',
  'points',
  'id',
  'name',
  'longitude',
  'latitude',
  'representative',
  'route',
  'zoom',
  'track',
  'source',
  'privacy',
  'trim_start_meters',
  'trim_end_meters',
  'simplify_tolerance_meters',
  'playback',
]);
const dangerousKeys = new Set(['__proto__', 'prototype', 'constructor', '<<']);
const standardTags = new Set(
  [
    'map',
    'seq',
    'str',
    'int',
    'float',
    'bool',
    'null',
    'binary',
    'omap',
    'pairs',
    'set',
    'timestamp',
  ].map((tag) => `tag:yaml.org,2002:${tag}`),
);

function failure(
  fieldPath: string,
  message: string,
): { ok: false; issues: readonly AuthorIssue[] } {
  return { ok: false, issues: [{ fieldPath, message }] };
}

/** Present only trusted diagnostics; values and parser source excerpts never enter UI text. */
export function formatAuthorIssues(issues: readonly AuthorIssue[]): string {
  return issues
    .map(
      (issue) =>
        `${issue.fieldPath}：${issue.message}${
          Number.isInteger(issue.line) &&
          issue.line! > 0 &&
          Number.isInteger(issue.column) &&
          issue.column! > 0
            ? `（第 ${issue.line} 行，第 ${issue.column} 列）`
            : ''
        }`,
    )
    .join('；');
}

function safeFieldPath(path: readonly PropertyKey[]): string {
  let fieldPath = 'map';
  for (const segment of path) {
    if (typeof segment === 'number') fieldPath += `[${segment}]`;
    else if (typeof segment === 'string' && safeFields.has(segment)) fieldPath += `.${segment}`;
    else break;
  }
  return fieldPath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function semanticMessage(fieldPath: string): string {
  if (fieldPath.endsWith('.longitude')) return 'must be a finite longitude from -180 to 180';
  if (fieldPath.endsWith('.latitude')) return 'must be a finite latitude from -90 to 90';
  if (fieldPath.endsWith('.name')) return 'must contain a non-empty point name';
  if (fieldPath.endsWith('.id')) return 'must contain a unique lowercase point identifier';
  if (fieldPath === 'map.representative')
    return 'must explicitly select an existing representative point';
  if (/^map\.route(?:\[\d+\])?$/u.test(fieldPath))
    return 'must contain at least two existing point references';
  if (fieldPath === 'map.points') return 'must contain at least one valid point';
  if (fieldPath === 'map.zoom') return 'must contain a finite zoom value';
  if (fieldPath === 'map.track.source')
    return 'must contain a relative local GPX, GeoJSON or JSON path';
  return 'must satisfy the map field requirements';
}

/** Inspect containers without recursion, counting repeated aliases as expanded values. */
function hasSafeContainers(root: unknown): boolean {
  const ancestors = new Set<object>();
  const stack: { value: unknown; exit?: boolean }[] = [{ value: root }];
  let remaining = AUTHOR_MAX_YAML_BYTES;
  while (stack.length > 0) {
    const { value, exit } = stack.pop()!;
    if (exit) {
      ancestors.delete(value as object);
      continue;
    }
    if (--remaining < 0) return false;
    if (value === null || typeof value !== 'object') continue;
    if (ancestors.has(value)) return false;
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype) return false;
    const keys = Object.keys(value);
    if (keys.some((key) => dangerousKeys.has(key))) return false;
    ancestors.add(value);
    stack.push({ value, exit: true });
    for (const key of keys) stack.push({ value: (value as Record<string, unknown>)[key] });
  }
  return true;
}

function copyMap(map: AuthorMapInput): AuthorMapInput {
  const track = map.track;
  return {
    points: map.points.map((point) => ({
      id: point.id,
      name: point.name,
      longitude: point.longitude,
      latitude: point.latitude,
    })),
    ...(map.representative !== undefined ? { representative: map.representative } : {}),
    ...(map.route !== undefined ? { route: [...map.route] } : {}),
    ...(map.zoom !== undefined ? { zoom: map.zoom } : {}),
    ...(track !== undefined
      ? {
          track: {
            source: track.source,
            ...(track.privacy !== undefined
              ? {
                  privacy: {
                    ...(track.privacy.trim_start_meters !== undefined
                      ? { trim_start_meters: track.privacy.trim_start_meters }
                      : {}),
                    ...(track.privacy.trim_end_meters !== undefined
                      ? { trim_end_meters: track.privacy.trim_end_meters }
                      : {}),
                  },
                }
              : {}),
            ...(track.simplify_tolerance_meters !== undefined
              ? { simplify_tolerance_meters: track.simplify_tolerance_meters }
              : {}),
            ...(track.playback !== undefined ? { playback: track.playback } : {}),
          },
        }
      : {}),
  };
}

function validateMap(raw: unknown): AuthorImportResult {
  if (isRecord(raw) && Array.isArray(raw.points) && raw.points.length > AUTHOR_MAX_POINTS) {
    return failure('map.points', `must contain at most ${AUTHOR_MAX_POINTS} points`);
  }
  if (isRecord(raw) && Array.isArray(raw.route) && raw.route.length > AUTHOR_MAX_ROUTE_STOPS) {
    return failure('map.route', `must contain at most ${AUTHOR_MAX_ROUTE_STOPS} stops`);
  }
  const result = postMapSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => {
        const fieldPath = safeFieldPath(issue.path);
        return { fieldPath, message: semanticMessage(fieldPath) };
      }),
    };
  }
  // Validate domain references, but copy the raw input to retain all omitted track defaults.
  if (normalizePostMapDocument(raw, 'author-map.yaml') === null) {
    return failure('map', 'must contain a valid map');
  }
  return { ok: true, map: copyMap(raw as AuthorMapInput) };
}

export function importAuthorYaml(source: string): AuthorImportResult {
  if (new TextEncoder().encode(source).length > AUTHOR_MAX_YAML_BYTES) {
    return failure('map', `YAML must contain at most ${AUTHOR_MAX_YAML_BYTES} UTF-8 bytes`);
  }
  try {
    const lineCounter = new LineCounter();
    const document = parseDocument(source, {
      strict: true,
      uniqueKeys: true,
      stringKeys: true,
      merge: false,
      prettyErrors: false,
      lineCounter,
    });
    if (document.errors.length > 0 || document.warnings.length > 0) {
      const error = document.errors[0] ?? document.warnings[0]!;
      const message =
        error.code === 'MULTIPLE_DOCS'
          ? 'YAML must contain only one document'
          : error.code === 'DUPLICATE_KEY'
            ? 'YAML mapping keys must be unique'
            : 'YAML syntax is invalid';
      const offset = error.pos[0];
      const location =
        Number.isInteger(offset) && offset >= 0 && offset <= source.length
          ? lineCounter.linePos(offset)
          : undefined;
      return {
        ok: false,
        issues: [
          {
            fieldPath: 'map',
            message,
            ...(location ? { line: location.line, column: location.col } : {}),
          },
        ],
      };
    }
    const nodes: unknown[] = [document.contents];
    let remaining = AUTHOR_MAX_YAML_BYTES;
    while (nodes.length > 0) {
      const node = nodes.pop();
      if (--remaining < 0) return failure('map', 'YAML structure exceeds the supported limit');
      if (isNode(node) && node.tag !== undefined && !standardTags.has(node.tag)) {
        return failure('map', 'YAML custom tags are not supported');
      }
      if (isMap(node) || isSeq(node)) nodes.push(...node.items);
      else if (isPair(node)) {
        if (!isScalar(node.key) || typeof node.key.value !== 'string') {
          return failure('map', 'YAML mapping keys must be strings');
        }
        if (dangerousKeys.has(node.key.value)) {
          return failure('map', 'YAML merge and prototype keys are not supported');
        }
        nodes.push(node.key, node.value);
      } else if (isAlias(node)) {
        // Alias resolution and expansion accounting belong to the YAML parser below.
        continue;
      }
    }
    const raw: unknown = document.toJS({ maxAliasCount: AUTHOR_MAX_ALIAS_COUNT });
    if (!hasSafeContainers(raw)) {
      return failure('map', 'YAML must contain bounded acyclic plain containers');
    }
    if (!isRecord(raw) || Object.keys(raw).length !== 1 || !Object.hasOwn(raw, 'map')) {
      return failure('map', 'YAML root must contain only the map field');
    }
    return validateMap(raw.map);
  } catch {
    return failure('map', 'must contain a safe valid map YAML document');
  }
}

export function exportAuthorYaml(draft: AuthorDraft): AuthorExportResult {
  try {
    const validated = validateMap(draftMapInput(draft));
    if (!validated.ok) return validated;
    const map = validated.map;
    const yaml = stringify({ map });
    if (new TextEncoder().encode(yaml).length > AUTHOR_MAX_YAML_BYTES) {
      return failure('map', `YAML must contain at most ${AUTHOR_MAX_YAML_BYTES} UTF-8 bytes`);
    }
    const imported = importAuthorYaml(yaml);
    if (!imported.ok) return imported;
    if (JSON.stringify(imported.map) !== JSON.stringify(map)) {
      return failure('map', 'exported YAML must preserve the map fields');
    }
    return { ok: true, yaml, map, revision: draft.revision };
  } catch (error) {
    if (error instanceof AuthorDraftError) {
      return {
        ok: false,
        issues: error.issues.map((issue) => {
          const fieldPath =
            /^map(?:\.[a-z_]+|\[\d+\])*$/u.test(issue.fieldPath) &&
            (issue.fieldPath.match(/[a-z_]+/gu) ?? []).every((field) => safeFields.has(field))
              ? issue.fieldPath
              : 'map';
          return { fieldPath, message: semanticMessage(fieldPath) };
        }),
      };
    }
    return failure('map', 'must contain a valid map draft for export');
  }
}
