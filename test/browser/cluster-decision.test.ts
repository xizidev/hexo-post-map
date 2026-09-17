import { describe, expect, it } from 'vitest';
import { decideClusterAction } from '../../src/browser/overview/cluster-decision';
import type { OverviewPost } from '../../src/templates/overview';

const a: OverviewPost = {
  title: 'A',
  url: '/a/',
  image: '/a.jpg',
  date: '2025-01-01T00:00:00Z',
  location: { name: 'A', longitude: 121, latitude: 31 },
};
const b: OverviewPost = {
  ...a,
  title: 'B',
  url: '/b/',
  date: '2026-01-01T00:00:00Z',
  location: { name: 'B', longitude: 122, latitude: 32 },
};
const bounds = { west: 121, south: 31, east: 122, north: 32 };
describe('cluster decisions', () => {
  it('zooms a separable cluster below maximum zoom', () => {
    expect(decideClusterAction({ zoom: 6, maxZoom: 18, posts: [a, b], bounds })).toEqual({
      type: 'zoom',
      bounds,
    });
  });
  it.each([18, 19])('opens newest-first results at zoom %s without mutating inputs', (zoom) => {
    const posts = Object.freeze([Object.freeze(a), Object.freeze(b)]);
    expect(decideClusterAction({ zoom, maxZoom: 18, posts, bounds })).toEqual({
      type: 'list',
      posts: [b, a],
    });
    expect(posts).toEqual([a, b]);
  });
  it('terminates identical coordinates even below maximum zoom', () => {
    expect(
      decideClusterAction({
        zoom: 6,
        maxZoom: 18,
        posts: [a, { ...b, location: a.location }],
        bounds: { west: 121, east: 121, south: 31, north: 31 },
      }).type,
    ).toBe('list');
  });
  it('still zooms separable collinear points', () => {
    expect(
      decideClusterAction({ zoom: 6, maxZoom: 18, posts: [a, b], bounds: { ...bounds, north: 31 } })
        .type,
    ).toBe('zoom');
  });
  it('opens one leaf directly and keeps equal-date ordering stable', () => {
    expect(decideClusterAction({ zoom: 6, maxZoom: 18, posts: [a], bounds })).toEqual({
      type: 'list',
      posts: [a],
    });
    const tied = { ...b, date: a.date };
    expect(decideClusterAction({ zoom: 18, maxZoom: 18, posts: [tied, a], bounds })).toEqual({
      type: 'list',
      posts: [tied, a],
    });
  });
});
