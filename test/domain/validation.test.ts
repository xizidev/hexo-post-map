import { describe, expect, it } from 'vitest';

import { PostMapValidationError } from '../../src/domain/errors';
import { normalizePostMap } from '../../src/domain/normalize';

const sourcePath = 'source/_posts/invalid.md';

function expectValidationError(raw: unknown, fieldPath: string): PostMapValidationError {
  try {
    normalizePostMap(raw, sourcePath);
  } catch (error) {
    expect(error).toBeInstanceOf(PostMapValidationError);
    const validationError = error as PostMapValidationError;
    expect(validationError.sourcePath).toBe(sourcePath);
    expect(validationError.fieldPath).toBe(fieldPath);
    expect(validationError.message).toContain(sourcePath);
    expect(validationError.message).toContain(fieldPath);
    return validationError;
  }

  throw new Error('expected normalizePostMap to throw PostMapValidationError');
}

describe('normalizePostMap validation diagnostics', () => {
  it('reports duplicate point identifiers at the duplicate id field', () => {
    const error = expectValidationError(
      {
        points: [
          { id: 'same', name: '甲', longitude: 121, latitude: 31 },
          { id: 'same', name: '乙', longitude: 122, latitude: 32 },
        ],
        representative: 'same',
      },
      'map.points[1].id',
    );

    expect(error.value).toBe('same');
  });

  it('reports invalid longitude at its exact field', () => {
    const error = expectValidationError(
      { points: [{ id: 'shanghai', name: '上海', longitude: 181, latitude: 31.2304 }] },
      'map.points[0].longitude',
    );

    expect(error.value).toBe(181);
  });

  it('reports invalid latitude at its exact field', () => {
    const error = expectValidationError(
      { points: [{ id: 'shanghai', name: '上海', longitude: 121.4737, latitude: 91 }] },
      'map.points[0].latitude',
    );

    expect(error.value).toBe(91);
  });

  it('requires representative for multiple points', () => {
    expectValidationError(
      {
        points: [
          { id: 'first', name: '第一站', longitude: 121, latitude: 31 },
          { id: 'second', name: '第二站', longitude: 122, latitude: 32 },
        ],
      },
      'map.representative',
    );
  });

  it('reports an unknown representative', () => {
    const error = expectValidationError(
      {
        representative: 'missing',
        points: [
          { id: 'first', name: '第一站', longitude: 121, latitude: 31 },
          { id: 'second', name: '第二站', longitude: 122, latitude: 32 },
        ],
      },
      'map.representative',
    );

    expect(error.value).toBe('missing');
  });

  it('reports an unknown route identifier at its exact index', () => {
    const error = expectValidationError(
      {
        representative: 'first',
        points: [
          { id: 'first', name: '第一站', longitude: 121, latitude: 31 },
          { id: 'second', name: '第二站', longitude: 122, latitude: 32 },
        ],
        route: ['first', 'missing'],
      },
      'map.route[1]',
    );

    expect(error.value).toBe('missing');
  });

  it('requires at least two route identifiers', () => {
    expectValidationError(
      {
        representative: 'first',
        points: [
          { id: 'first', name: '第一站', longitude: 121, latitude: 31 },
          { id: 'second', name: '第二站', longitude: 122, latitude: 32 },
        ],
        route: ['first'],
      },
      'map.route',
    );
  });

  it('reports invalid point identifiers at the id field', () => {
    const error = expectValidationError(
      { points: [{ id: 'Uppercase', name: '上海', longitude: 121.4737, latitude: 31.2304 }] },
      'map.points[0].id',
    );

    expect(error.value).toBe('Uppercase');
  });

  it('reports names that are empty after trimming', () => {
    const error = expectValidationError(
      { points: [{ id: 'shanghai', name: '   ', longitude: 121.4737, latitude: 31.2304 }] },
      'map.points[0].name',
    );

    expect(error.value).toBe('   ');
  });

  it('reports NaN coordinates at their exact field', () => {
    const error = expectValidationError(
      { points: [{ id: 'shanghai', name: '上海', longitude: Number.NaN, latitude: 31.2304 }] },
      'map.points[0].longitude',
    );

    expect(error.value).toBeNaN();
  });

  it('reports infinite coordinates at their exact field', () => {
    const error = expectValidationError(
      {
        points: [
          { id: 'shanghai', name: '上海', longitude: 121.4737, latitude: Number.POSITIVE_INFINITY },
        ],
      },
      'map.points[0].latitude',
    );

    expect(error.value).toBe(Number.POSITIVE_INFINITY);
  });

  it('requires at least one point', () => {
    const error = expectValidationError({ points: [] }, 'map.points');

    expect(error.value).toEqual([]);
  });

  it('reports an unknown map field at the unknown key', () => {
    const error = expectValidationError(
      {
        points: [{ id: 'shanghai', name: '上海', longitude: 121.4737, latitude: 31.2304 }],
        typo: true,
      },
      'map.typo',
    );

    expect(error.value).toBe(true);
  });

  it('reports an unknown point field at the unknown key', () => {
    const error = expectValidationError(
      {
        points: [
          { id: 'shanghai', name: '上海', longitude: 121.4737, latitude: 31.2304, typo: true },
        ],
      },
      'map.points[0].typo',
    );

    expect(error.value).toBe(true);
  });
});
