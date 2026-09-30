import { describe, expect, it } from 'vitest';

import { TrackBuildError } from '../../src/tracks/errors';
import { parseGeoJson } from '../../src/tracks/geojson';
import { parseTrackSource } from '../../src/tracks/parse';

const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const line = {
  type: 'LineString',
  coordinates: [
    [118, 32],
    [119, 33],
  ],
};

describe('parseGeoJson', () => {
  it('reads a direct line, copies optional elevation, and ignores extra dimensions', () => {
    expect(
      parseGeoJson(
        json({
          type: 'LineString',
          coordinates: [
            [118, 32, -5, 'private'],
            [119, 33, 15, { secret: true }],
          ],
          properties: { coordTimes: ['PRIVATE_TIME'], name: '南京' },
          id: 'private',
          bbox: [0, 0, 1, 1],
        }),
      ),
    ).toEqual([
      [
        { coordinate: [118, 32], elevationMeters: -5 },
        { coordinate: [119, 33], elevationMeters: 15 },
      ],
    ]);
  });

  it('preserves ordering and segment boundaries through standard nested containers', () => {
    expect(
      parseGeoJson(
        json({
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', geometry: null, properties: { geometry: line } },
            { type: 'Feature', geometry: line },
            {
              type: 'Feature',
              geometry: {
                type: 'GeometryCollection',
                geometries: [
                  { type: 'Point', coordinates: [20, 20] },
                  {
                    type: 'MultiLineString',
                    coordinates: [
                      [],
                      [
                        [1, 2],
                        [3, 4],
                      ],
                      [
                        [5, 6],
                        [7, 8],
                      ],
                    ],
                  },
                  { type: 'GeometryCollection', geometries: [line] },
                ],
              },
            },
          ],
        }),
      ),
    ).toEqual([
      [{ coordinate: [118, 32] }, { coordinate: [119, 33] }],
      [{ coordinate: [1, 2] }, { coordinate: [3, 4] }],
      [{ coordinate: [5, 6] }, { coordinate: [7, 8] }],
      [{ coordinate: [118, 32] }, { coordinate: [119, 33] }],
    ]);
  });

  it('reads a direct multiline and a feature without foreign properties', () => {
    expect(
      parseGeoJson(json({ type: 'MultiLineString', coordinates: [line.coordinates] })),
    ).toEqual([[{ coordinate: [118, 32] }, { coordinate: [119, 33] }]]);
    expect(
      parseGeoJson(
        json({ type: 'Feature', properties: { coordTimes: ['private'] }, geometry: line }),
      ),
    ).toEqual([[{ coordinate: [118, 32] }, { coordinate: [119, 33] }]]);
  });

  it.each([
    null,
    false,
    'private',
    [],
    {},
    { type: 123 },
    { type: 'Unknown' },
    { type: 'Feature' },
    { type: 'FeatureCollection', features: {} },
    { type: 'FeatureCollection', features: [line] },
    { type: 'GeometryCollection', geometries: {} },
    { type: 'GeometryCollection', geometries: [{ type: 'Feature', geometry: line }] },
    { type: 'LineString' },
    { type: 'LineString', coordinates: {} },
    { type: 'MultiLineString', coordinates: [null] },
  ])('rejects invalid GeoJSON root, type, or standard members: %j', (value) => {
    expect(() => parseGeoJson(json(value))).toThrow(TrackBuildError);
  });

  it.each([
    null,
    {},
    [],
    [1],
    ['118', 32],
    [118, null],
    [181, 32],
    [-181, 32],
    [118, 91],
    [118, -91],
    [118, 32, null],
    [118, 32, '12'],
  ])('rejects malformed coordinate or elevation values: %j', (value) => {
    expect(() =>
      parseGeoJson(json({ type: 'LineString', coordinates: [value, [119, 33]] })),
    ).toThrow(TrackBuildError);
  });

  it.each([
    '{PRIVATE_BYTES',
    '{"type":"LineString","coordinates":[[1e999,32],[119,33]]}',
    '{"type":"LineString","coordinates":[[118,32,1e999],[119,33]]}',
  ])('redacts malformed JSON and non-finite numbers', (text) => {
    const parse = () => parseGeoJson(Buffer.from(text));
    expect(parse).toThrow(TrackBuildError);
    expect(parse).not.toThrow(/PRIVATE_BYTES|1e999/);
  });

  it.each([
    { type: 'Point', coordinates: [1, 2], foreign: line },
    { type: 'Feature', geometry: null },
    { type: 'FeatureCollection', features: [] },
    { type: 'LineString', coordinates: [] },
    { type: 'LineString', coordinates: [[1, 2]] },
    {
      type: 'LineString',
      coordinates: [
        [1, 2],
        [1, 2, 9],
      ],
    },
    { type: 'MultiLineString', coordinates: [[[1, 2]], [[3, 4]]] },
  ])('requires two distinct usable points in a single segment: %j', (value) => {
    expect(() => parseGeoJson(json(value))).toThrow(/distinct/);
  });

  it('enforces the aggregate 200,000 limit before visiting later invalid coordinates', () => {
    const coordinates = Array.from({ length: 200000 }, (_, index) => [index % 2, 2]);
    expect(parseGeoJson(json({ type: 'LineString', coordinates }))[0]).toHaveLength(200000);
    expect(() =>
      parseGeoJson(
        json({
          type: 'MultiLineString',
          coordinates: [
            coordinates,
            [
              [3, 4],
              ['INVALID', 4],
            ],
          ],
        }),
      ),
    ).toThrow(/200,000/);
  });

  it('rejects invalid UTF-8 rather than silently replacing it', () => {
    expect(() => parseGeoJson(Buffer.from([0xff]))).toThrow(/UTF-8/);
  });
});

describe('parseTrackSource', () => {
  it('dispatches the validated source format without publishing source identity', () => {
    const common = { canonicalPath: '/private/track', fingerprint: 'private-fingerprint' };
    const expected = [[{ coordinate: [118, 32] }, { coordinate: [119, 33] }]];
    expect(parseTrackSource({ ...common, format: 'geojson', bytes: json(line) })).toEqual(expected);
    expect(
      parseTrackSource({
        ...common,
        format: 'gpx',
        bytes: Buffer.from(
          '<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lon="118" lat="32"/><trkpt lon="119" lat="33"/></trkseg></trk></gpx>',
        ),
      }),
    ).toEqual(expected);
  });
});
