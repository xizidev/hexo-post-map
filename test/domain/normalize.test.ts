import { describe, expect, it } from 'vitest';

import { normalizePostMap } from '../../src/domain/normalize';

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
});
