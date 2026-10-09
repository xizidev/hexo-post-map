import { describe, expect, it, vi } from 'vitest';
import { createPostIndex } from '../../src/browser/overview/post-index';
import { chooseRandomPost, randomTargetZoom } from '../../src/browser/overview/random';

const a = {
  title: 'A',
  url: '/a/',
  date: '2026-01-01T00:00:00Z',
  image: '/a.jpg',
  location: { name: 'A', longitude: 121.123456789, latitude: 31.987654321 },
};
const b = { ...a, title: 'B', url: '/b/' };
const c = { ...a, title: 'C', url: '/c/' };

describe('random overview selection', () => {
  it('avoids immediate repeats and never samples an empty set', () => {
    const rng = vi.fn(() => 0);
    expect(chooseRandomPost(createPostIndex([]), undefined, rng)).toBeUndefined();
    expect(rng).not.toHaveBeenCalled();
    expect(chooseRandomPost(createPostIndex([a, b]), a.url, rng)).toBe(b);
    expect(chooseRandomPost(createPostIndex([a]), a.url, rng)).toBe(a);
  });
  it('excludes unsafe empty and duplicate URLs without reordering valid candidates', () => {
    const index = createPostIndex([
      { ...a, url: '' },
      { ...a, url: 'javascript:alert(1)' },
      { ...a, url: 'https://user@example.test/a/' },
      a,
      b,
      { ...a },
      c,
    ]);
    expect(chooseRandomPost(index, undefined, () => 0)).toBe(b);
    expect(chooseRandomPost(index, undefined, () => 0.999999)).toBe(c);
  });
  it.each([
    [0, a],
    [0.333333, a],
    [1 / 3, b],
    [0.666666, b],
    [2 / 3, c],
    [0.999999, c],
  ])('samples candidates in equal intervals for rng=%s', (sample, expected) => {
    expect(chooseRandomPost(createPostIndex([a, b, c]), undefined, () => sample)).toBe(expected);
  });
  it.each([
    [0, b],
    [0.499999, b],
    [0.5, c],
    [0.999999, c],
  ])('samples remaining candidates in equal intervals for rng=%s', (sample, expected) => {
    expect(chooseRandomPost(createPostIndex([a, b, c]), '/a/', () => sample)).toBe(expected);
  });
  it.each([NaN, Infinity, -Infinity, -0.01, 1, 2])('rejects invalid rng=%s', (sample) => {
    expect(chooseRandomPost(createPostIndex([a]), undefined, () => sample)).toBeUndefined();
  });
  it('treats a failed RNG as no selection', () => {
    expect(
      chooseRandomPost(createPostIndex([a]), undefined, () => {
        throw new Error('rng');
      }),
    ).toBeUndefined();
  });
  it.each([
    [4, 18, 11],
    [15, 18, 15],
    [4, 8, 8],
    [19, 18, 18],
    [11.25, 18, 11.25],
  ])('clamps zoom %s to max %s with target %s', (current, max, expected) => {
    expect(randomTargetZoom(current, max)).toBe(expected);
  });
});
