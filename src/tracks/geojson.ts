import type { RawTrack, RawTrackPoint } from './types';
import {
  coordinate,
  decodeUtf8,
  enforcePointLimit,
  finiteNumber,
  invalidTrack,
  validateRawTrack,
} from './validation';

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) return invalidTrack('invalid GeoJSON array member');
  return value;
}

type Entry = { value: unknown; kind: 'root' | 'geometry' | 'feature' };

export function parseGeoJson(bytes: Uint8Array): RawTrack {
  const text = decodeUtf8(bytes);
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return invalidTrack('malformed GeoJSON JSON');
  }
  const segments: RawTrackPoint[][] = [];
  let count = 0;
  const addLine = (value: unknown) => {
    const segment: RawTrackPoint[] = [];
    for (const item of array(value)) {
      enforcePointLimit(++count);
      const position = array(item);
      const point: RawTrackPoint = {
        coordinate: coordinate(position[0], position[1]),
        ...(position.length > 2 ? { elevationMeters: finiteNumber(position[2], 'elevation') } : {}),
      };
      segment.push(point);
    }
    if (segment.length) segments.push(segment);
  };

  // An explicit stack also supports deeply nested valid collections without call-stack overflow.
  const pending: Entry[] = [{ value: root, kind: 'root' }];
  const pushChildren = (value: unknown, kind: Entry['kind']) => {
    const children = array(value);
    for (let index = children.length - 1; index >= 0; index--) {
      pending.push({ value: children[index], kind });
    }
  };
  while (pending.length) {
    const { value, kind } = pending.pop()!;
    if (value === null && kind === 'geometry') continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      invalidTrack('invalid GeoJSON object');
    }
    const object = value as Record<string, unknown>;
    if (kind === 'feature' && object.type !== 'Feature') invalidTrack('expected a GeoJSON feature');
    if (kind === 'geometry' && (object.type === 'Feature' || object.type === 'FeatureCollection')) {
      invalidTrack('expected a GeoJSON geometry');
    }
    switch (object.type) {
      case 'Feature':
        pending.push({ value: object.geometry, kind: 'geometry' });
        break;
      case 'FeatureCollection':
        pushChildren(object.features, 'feature');
        break;
      case 'GeometryCollection':
        pushChildren(object.geometries, 'geometry');
        break;
      case 'LineString':
        addLine(object.coordinates);
        break;
      case 'MultiLineString':
        for (const line of array(object.coordinates)) addLine(line);
        break;
      case 'Point':
      case 'MultiPoint':
      case 'Polygon':
      case 'MultiPolygon':
        break;
      default:
        invalidTrack('unsupported GeoJSON type');
    }
  }
  return validateRawTrack(segments);
}
