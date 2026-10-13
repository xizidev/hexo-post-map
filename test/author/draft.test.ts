import { describe, expect, it } from 'vitest';

import {
  addAuthorPoint,
  createAuthorDraft,
  deleteAuthorPoint,
  draftMapInput,
  moveAuthorPoint,
  selectAuthorRepresentative,
  setAuthorRoute,
  setAuthorZoom,
  updateAuthorPoint,
} from '../../src/author/draft';
import {
  AuthorDraftError,
  type AuthorMapInput,
  type AuthorPointInput,
} from '../../src/author/types';

function point(name: string, longitude = 118.123456789, latitude = 32.123456789): AuthorPointInput {
  return { name, longitude, latitude };
}

function expectIssue(operation: () => unknown, fieldPath: string): void {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AuthorDraftError);
  expect((caught as AuthorDraftError).issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ fieldPath, message: expect.any(String) })]),
  );
}

describe('author draft', () => {
  it('keeps repeated stops independent from point order', () => {
    const a = addAuthorPoint(createAuthorDraft(), point('A'));
    const b = addAuthorPoint(a, point('B'));
    const route = setAuthorRoute(b, ['point-1', 'point-2', 'point-1']);
    const reordered = moveAuthorPoint(route, 'point-2', 'up');
    expect(draftMapInput(reordered).route).toEqual(['point-1', 'point-2', 'point-1']);
    expect(draftMapInput(reordered).representative).toBe('point-1');
    expect(reordered.points.map((p) => p.id)).toEqual(['point-2', 'point-1']);
  });

  it('never reuses deleted imported or generated IDs', () => {
    const imported = createAuthorDraft({
      points: [{ id: 'point-2', ...point('Imported') }],
    });
    const first = addAuthorPoint(imported, point('First'));
    const second = addAuthorPoint(deleteAuthorPoint(first, 'point-2'), point('Second'));
    const third = addAuthorPoint(deleteAuthorPoint(second, 'point-1'), point('Third'));
    expect(third.points.map((p) => p.id)).toEqual(['point-3', 'point-4']);
    expect(third.importedIds).toEqual(['point-2']);
    expect(third.nextPointOrdinal).toBe(5);
  });

  it('requires explicit selection after representative deletion with one survivor', () => {
    const two = addAuthorPoint(addAuthorPoint(createAuthorDraft(), point('A')), point('B'));
    const pending = deleteAuthorPoint(two, 'point-1');
    expect(pending.representativeMode).toBe('pending');
    expect(pending.representativeId).toBeUndefined();
    expectIssue(() => draftMapInput(pending), 'map.representative');
    const selected = selectAuthorRepresentative(pending, 'point-2');
    expect(selected.representativeMode).toBe('explicit');
    expect(draftMapInput(selected).representative).toBe('point-2');
  });

  it('adding another point does not resolve a pending representative', () => {
    const one = addAuthorPoint(createAuthorDraft(), point('A'));
    const deleted = deleteAuthorPoint(one, 'point-1');
    const added = addAuthorPoint(deleted, point('B'));
    expect(added.representativeMode).toBe('pending');
    expect(added.representativeId).toBeUndefined();
    expectIssue(() => draftMapInput(added), 'map.representative');
  });

  it('removes every reference to a deleted point', () => {
    const two = addAuthorPoint(addAuthorPoint(createAuthorDraft(), point('A')), point('B'));
    const routed = setAuthorRoute(two, ['point-2', 'point-1', 'point-2', 'point-2']);
    const deleted = deleteAuthorPoint(routed, 'point-2');
    expect(deleted.route).toEqual(['point-1']);
    expect(deleted.representativeId).toBe('point-1');
    expect(routed.route).toEqual(['point-2', 'point-1', 'point-2', 'point-2']);
  });

  it('blocks empty draft and one-stop route', () => {
    expectIssue(() => draftMapInput(createAuthorDraft()), 'map.points');
    const one = addAuthorPoint(createAuthorDraft(), point('A'));
    const routed = setAuthorRoute(one, ['point-1']);
    expect(routed.route).toEqual(['point-1']);
    expectIssue(() => draftMapInput(routed), 'map.route');
    expect(draftMapInput(setAuthorRoute(routed, []))).not.toHaveProperty('route');
  });

  it('keeps coincident points and precision', () => {
    const draft = addAuthorPoint(addAuthorPoint(createAuthorDraft(), point('A')), point('B'));
    expect(draftMapInput(draft).points).toEqual([
      { id: 'point-1', name: 'A', longitude: 118.123456789, latitude: 32.123456789 },
      { id: 'point-2', name: 'B', longitude: 118.123456789, latitude: 32.123456789 },
    ]);
  });

  it('keeps imported explicit single representative', () => {
    const draft = createAuthorDraft({
      representative: 'imported',
      points: [{ id: 'imported', ...point('A') }],
    });
    expect(draft.representativeMode).toBe('explicit');
    expect(draftMapInput(draft).representative).toBe('imported');
  });

  it('omits implicit single representative and promotes it when the second point is added', () => {
    const one = addAuthorPoint(createAuthorDraft(), point('A'));
    expect(one.representativeMode).toBe('implicit');
    expect(one.representativeId).toBe('point-1');
    expect(draftMapInput(one)).not.toHaveProperty('representative');
    const two = addAuthorPoint(one, point('B'));
    expect(two.representativeMode).toBe('explicit');
    expect(draftMapInput(two).representative).toBe('point-1');
  });

  it('rejects unknown IDs and point 201 or stop 1001', () => {
    const one = addAuthorPoint(createAuthorDraft(), point('A'));
    expectIssue(() => updateAuthorPoint(one, 'missing', { name: 'B' }), 'map.points');
    expectIssue(() => deleteAuthorPoint(one, 'missing'), 'map.points');
    expectIssue(() => moveAuthorPoint(one, 'missing', 'up'), 'map.points');
    expectIssue(() => selectAuthorRepresentative(one, 'missing'), 'map.representative');
    expectIssue(() => setAuthorRoute(one, ['point-1', 'missing']), 'map.route[1]');
    let full = createAuthorDraft();
    for (let i = 0; i < 200; i += 1) full = addAuthorPoint(full, point(`P${i}`));
    expect(full.points).toHaveLength(200);
    expectIssue(() => addAuthorPoint(full, point('Overflow')), 'map.points');
    const route = Array<string>(1000).fill('point-1');
    expect(setAuthorRoute(one, route).route).toHaveLength(1000);
    expectIssue(() => setAuthorRoute(one, [...route, 'point-1']), 'map.route');
  });

  it('preserves imported finite zoom but bounds newly set zoom to 2..20', () => {
    const draft = createAuthorDraft({ points: [{ id: 'a', ...point('A') }], zoom: -100 });
    expect(draftMapInput(draft).zoom).toBe(-100);
    expect(draftMapInput(setAuthorZoom(draft, 2)).zoom).toBe(2);
    expect(draftMapInput(setAuthorZoom(draft, 20)).zoom).toBe(20);
    expect(draftMapInput(setAuthorZoom(draft, undefined))).not.toHaveProperty('zoom');
    for (const zoom of [1.99, 20.01, NaN, Infinity, -Infinity]) {
      expectIssue(() => setAuthorZoom(draft, zoom), 'map.zoom');
    }
  });

  it('preserves imported track fields and omitted defaults without sharing mutable input', () => {
    const map: AuthorMapInput = {
      points: [{ id: 'a', ...point(' A ') }],
      track: { source: 'trip.gpx', privacy: { trim_start_meters: 12 }, playback: false },
    };
    const draft = createAuthorDraft(map);
    map.points[0]!.name = 'Changed';
    map.track!.privacy!.trim_start_meters = 999;
    expect(draftMapInput(draft)).toEqual({
      points: [{ id: 'a', ...point(' A ') }],
      track: { source: 'trip.gpx', privacy: { trim_start_meters: 12 }, playback: false },
    });
    const exported = draftMapInput(draft);
    exported.points[0]!.name = 'Changed again';
    exported.track!.privacy!.trim_start_meters = 888;
    expect(draft.points[0]!.name).toBe(' A ');
    expect(draft.track!.privacy!.trim_start_meters).toBe(12);
  });

  it('keeps ID stable during editing and allows an empty name until export', () => {
    const before = addAuthorPoint(createAuthorDraft(), point('A'));
    const edited = updateAuthorPoint(before, 'point-1', { name: '', longitude: 120.987654321 });
    expect(edited.points).toEqual([
      { id: 'point-1', name: '', longitude: 120.987654321, latitude: 32.123456789 },
    ]);
    expect(before.points).toEqual([{ id: 'point-1', ...point('A') }]);
    expectIssue(() => draftMapInput(edited), 'map.points[0].name');
    expect(draftMapInput(updateAuthorPoint(edited, 'point-1', { name: 'B' })).points[0]!.id).toBe(
      'point-1',
    );
  });

  it.each([
    ['longitude', 181],
    ['longitude', -181],
    ['longitude', NaN],
    ['latitude', 91],
    ['latitude', -91],
    ['latitude', Infinity],
  ] as const)('rejects invalid %s %s in additions and edits', (field, value) => {
    const empty = createAuthorDraft();
    expectIssue(
      () => addAuthorPoint(empty, { ...point('A'), [field]: value }),
      `map.points[0].${field}`,
    );
    const one = addAuthorPoint(empty, point('A'));
    expectIssue(
      () => updateAuthorPoint(one, 'point-1', { [field]: value }),
      `map.points[0].${field}`,
    );
    expect(one.revision).toBe(1);
  });

  it('rejects blank new names while retaining exact boundary coordinates', () => {
    expectIssue(() => addAuthorPoint(createAuthorDraft(), point('  ')), 'map.points[0].name');
    const draft = addAuthorPoint(createAuthorDraft(), point('Bounds', -180, 90));
    expect(draftMapInput(draft).points[0]).toEqual({
      id: 'point-1',
      name: 'Bounds',
      longitude: -180,
      latitude: 90,
    });
  });

  it('increments revision only for effective changes and leaves sorting boundaries unchanged', () => {
    const one = addAuthorPoint(createAuthorDraft(), point('A'));
    expect(one.revision).toBe(1);
    expect(moveAuthorPoint(one, 'point-1', 'up')).toBe(one);
    expect(moveAuthorPoint(one, 'point-1', 'down')).toBe(one);
    expect(updateAuthorPoint(one, 'point-1', {})).toBe(one);
    expect(updateAuthorPoint(one, 'point-1', { name: 'A' })).toBe(one);
    expect(setAuthorRoute(one, [])).toBe(one);
    expect(setAuthorZoom(one, undefined)).toBe(one);
    const explicit = selectAuthorRepresentative(one, 'point-1');
    expect(explicit.revision).toBe(2);
    expect(selectAuthorRepresentative(explicit, 'point-1')).toBe(explicit);
    const zoomed = setAuthorZoom(explicit, 5);
    expect(zoomed.revision).toBe(3);
    expect(setAuthorZoom(zoomed, 5)).toBe(zoomed);
    const routed = setAuthorRoute(zoomed, ['point-1', 'point-1']);
    expect(routed.revision).toBe(4);
    expect(setAuthorRoute(routed, ['point-1', 'point-1'])).toBe(routed);
    const added = addAuthorPoint(routed, point('B'));
    const moved = moveAuthorPoint(added, 'point-2', 'up');
    expect(moved.revision).toBe(6);
    expect(added.points.map((p) => p.id)).toEqual(['point-1', 'point-2']);
    expect(deleteAuthorPoint(moved, 'point-2').revision).toBe(7);
  });

  it('copies route input before storing it', () => {
    const one = addAuthorPoint(createAuthorDraft(), point('A'));
    const route = ['point-1', 'point-1'];
    const draft = setAuthorRoute(one, route);
    route[0] = 'missing';
    expect(draftMapInput(draft).route).toEqual(['point-1', 'point-1']);
  });

  it('validates imports using the domain schema and author limits', () => {
    expectIssue(() => createAuthorDraft({ points: [] }), 'map.points');
    expectIssue(
      () => createAuthorDraft({ points: [{ id: 'bad_ID', ...point('A') }] }),
      'map.points[0].id',
    );
    expectIssue(
      () => createAuthorDraft({ points: [{ id: 'a', ...point('A') }], representative: 'missing' }),
      'map.representative',
    );
    expectIssue(
      () => createAuthorDraft({ points: [{ id: 'a', ...point('A') }], zoom: Infinity }),
      'map.zoom',
    );
    const points = Array.from({ length: 201 }, (_, i) => ({ id: `p-${i}`, ...point('A') }));
    expectIssue(() => createAuthorDraft({ points, representative: 'p-0' }), 'map.points');
    expectIssue(
      () =>
        createAuthorDraft({
          points: [{ id: 'a', ...point('A') }],
          route: Array<string>(1001).fill('a'),
        }),
      'map.route',
    );
  });
});
