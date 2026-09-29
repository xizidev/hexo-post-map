import { describe, expect, it } from 'vitest';

import { normalizePostMap, normalizePostMapDocument } from '../../src/domain/normalize';

describe('normalizePostMap', () => {
  it('returns null when map is omitted', () => {
    expect(normalizePostMap(undefined, 'source/_posts/plain.md')).toBeNull();
  });

  it('uses the only point as representative', () => {
    const map = normalizePostMap(
      { points: [{ id: 'shanghai', name: '上海', longitude: 121.4737, latitude: 31.2304 }] },
      'source/_posts/shanghai.md',
    );

    expect(map?.representative.id).toBe('shanghai');
    expect(map?.route).toEqual([]);
  });

  it('resolves a multi-point representative and route in order', () => {
    const map = normalizePostMap(
      {
        representative: 'summit',
        points: [
          { id: 'visitor-center', name: '游客中心', longitude: 114.15, latitude: 27.46 },
          { id: 'summit', name: '金顶', longitude: 114.17, latitude: 27.45 },
        ],
        route: ['visitor-center', 'summit'],
      },
      'source/_posts/wugongshan.md',
    );

    expect(map?.representative.id).toBe('summit');
    expect(map?.route.map((point) => point.id)).toEqual(['visitor-center', 'summit']);
  });

  it('returns a deeply frozen normalized value', () => {
    const map = normalizePostMap(
      { points: [{ id: 'shanghai', name: '上海', longitude: 121.4737, latitude: 31.2304 }] },
      'source/_posts/shanghai.md',
    );

    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.isFrozen(map?.points)).toBe(true);
    expect(Object.isFrozen(map?.representative)).toBe(true);
    expect(Object.isFrozen(map?.representative.coordinate)).toBe(true);
    expect(Object.isFrozen(map?.route)).toBe(true);
  });

  it('keeps point-only browser output exactly compatible with the server document map', () => {
    const raw = {
      representative: 'summit',
      points: [
        { id: 'station', name: '车站', longitude: 118.7977, latitude: 32.0872 },
        { id: 'summit', name: '山顶', longitude: 118.8, latitude: 32.09 },
      ],
      route: ['station', 'summit'],
      zoom: 11,
    };
    const expected = {
      points: [
        { id: 'station', name: '车站', coordinate: [118.7977, 32.0872] },
        { id: 'summit', name: '山顶', coordinate: [118.8, 32.09] },
      ],
      representative: { id: 'summit', name: '山顶', coordinate: [118.8, 32.09] },
      route: [
        { id: 'station', name: '车站', coordinate: [118.7977, 32.0872] },
        { id: 'summit', name: '山顶', coordinate: [118.8, 32.09] },
      ],
      zoom: 11,
    };

    expect(normalizePostMap(raw, 'source/_posts/trip.md')).toEqual(expected);
    expect(normalizePostMapDocument(raw, 'source/_posts/trip.md')).toEqual({ map: expected });
    expect(normalizePostMapDocument(undefined, 'source/_posts/plain.md')).toBeNull();
  });

  it('normalizes exact track defaults only in the deeply frozen server document', () => {
    const raw = {
      points: [{ id: 'station', name: '车站', longitude: 118.7977, latitude: 32.0872 }],
      track: { source: './tracks/trip.GPX' },
    };
    const sourcePath = 'source/_posts/trip.md';
    const document = normalizePostMapDocument(raw, sourcePath);
    const browserMap = normalizePostMap(raw, sourcePath);

    expect(document?.track).toEqual({
      source: './tracks/trip.GPX',
      privacy: { trimStartMeters: 0, trimEndMeters: 0 },
      simplifyToleranceMeters: 5,
      playback: true,
    });
    expect(document?.map).toEqual(browserMap);
    expect(browserMap).not.toHaveProperty('track');
    expect(JSON.stringify(browserMap)).not.toContain('trip.GPX');
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document?.map)).toBe(true);
    expect(Object.isFrozen(document?.track)).toBe(true);
    expect(Object.isFrozen(document?.track?.privacy)).toBe(true);
  });

  it('preserves explicit track options in the server document', () => {
    const document = normalizePostMapDocument(
      {
        points: [{ id: 'station', name: '车站', longitude: 118.7977, latitude: 32.0872 }],
        track: {
          source: 'trip.geojson',
          privacy: { trim_start_meters: 300.5, trim_end_meters: 25 },
          simplify_tolerance_meters: 10000,
          playback: false,
        },
      },
      'source/_posts/trip.md',
    );

    expect(document?.track).toEqual({
      source: 'trip.geojson',
      privacy: { trimStartMeters: 300.5, trimEndMeters: 25 },
      simplifyToleranceMeters: 10000,
      playback: false,
    });
  });

  it('accepts zero simplification tolerance and non-negative trim boundaries', () => {
    const document = normalizePostMapDocument(
      {
        points: [{ id: 'station', name: '车站', longitude: 118.7977, latitude: 32.0872 }],
        track: {
          source: 'trip.json',
          privacy: { trim_start_meters: 0, trim_end_meters: 0 },
          simplify_tolerance_meters: 0,
        },
      },
      'source/_posts/trip.md',
    );

    expect(document?.track?.simplifyToleranceMeters).toBe(0);
    expect(document?.track?.privacy).toEqual({ trimStartMeters: 0, trimEndMeters: 0 });
  });
});
