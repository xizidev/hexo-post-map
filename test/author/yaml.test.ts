import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { createAuthorDraft, setAuthorRoute, updateAuthorPoint } from '../../src/author/draft';
import type { AuthorDraft, AuthorMapInput } from '../../src/author/types';
import { exportAuthorYaml, importAuthorYaml, type AuthorExportResult } from '../../src/author/yaml';
import { normalizePostMapDocument } from '../../src/domain/normalize';

const single: AuthorMapInput = {
  points: [{ id: 'a', name: 'A', longitude: 118.123456789, latitude: 32 }],
};
const source =
  'map:\n  points:\n    - { id: a, name: A, longitude: 118.123456789, latitude: 32 }\n';

function roundTrip(source: string): AuthorExportResult {
  const imported = importAuthorYaml(source);
  if (!imported.ok) return imported;
  return exportAuthorYaml(createAuthorDraft(imported.map));
}

function rejected(source: string): void {
  const result = importAuthorYaml(source);
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty('map');
  if (result.ok) throw new Error('Expected invalid import');
  expect(result.issues.length).toBeGreaterThan(0);
  for (const issue of result.issues) {
    expect(issue.fieldPath).toEqual(expect.any(String));
    expect(issue.message).toEqual(expect.any(String));
  }
}

describe('author YAML codec', () => {
  it('reports semantic coordinate and reference reasons without hostile values', () => {
    const coordinate = importAuthorYaml(source.replace('118.123456789', '181'));
    expect(coordinate).toMatchObject({
      ok: false,
      issues: [
        {
          fieldPath: 'map.points[0].longitude',
          message: 'must be a finite longitude from -180 to 180',
        },
      ],
    });
    const reference = importAuthorYaml(`${source}  representative: hostile-value\n`);
    expect(reference).toMatchObject({
      ok: false,
      issues: [
        {
          fieldPath: 'map.representative',
          message: 'must explicitly select an existing representative point',
        },
      ],
    });
    expect(JSON.stringify(reference)).not.toContain('hostile-value');
  });
  it.each([
    ['map: [hostile-value', 'YAML syntax is invalid', 1, 20],
    ['map: {}\nmap: hostile-value', 'YAML mapping keys must be unique', 2, 1],
    ['map: {}\n---\nmap: hostile-value', 'YAML must contain only one document', 2, 1],
  ])('reports safe reasons and source locations for %s', (input, reason, line, column) => {
    const result = importAuthorYaml(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid YAML');
    expect(result.issues[0]?.message).toBe(reason);
    expect(result.issues[0]?.line).toBe(line);
    expect(result.issues[0]?.column).toBe(column);
    expect(JSON.stringify(result)).not.toContain('hostile-value');
  });
  it('retains omitted track defaults and repeated route stops', () => {
    const draft = createAuthorDraft({
      points: [{ id: 'a', name: 'A: #一\n二', longitude: 118.123456789, latitude: 32 }],
      representative: 'a',
      route: ['a', 'a'],
      zoom: 21,
      track: { source: 'walk.gpx' },
    });
    const out = exportAuthorYaml(draft);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('Expected valid export');
    const back = importAuthorYaml(out.yaml);
    expect(back).toMatchObject({ ok: true, map: { track: { source: 'walk.gpx' } } });
    expect(out.map.track).toEqual({ source: 'walk.gpx' });
    expect(out.map.route).toEqual(['a', 'a']);
    expect(out.yaml).not.toContain('---');
    expect(normalizePostMapDocument(out.map, 'author-map.yaml')?.map.zoom).toBe(21);
  });

  it('preserves single-point implicit and explicit representatives', () => {
    expect(roundTrip(source)).toMatchObject({ ok: true, map: single, revision: 0 });
    expect(roundTrip(`${source}  representative: a\n`)).toMatchObject({
      ok: true,
      map: { ...single, representative: 'a' },
    });
    const out = roundTrip(source);
    if (!out.ok) throw new Error('Expected valid export');
    expect(out.map).not.toHaveProperty('representative');
    expect(out.map).not.toHaveProperty('zoom');
  });

  it('preserves multiple coincident points and explicit route order', () => {
    const map: AuthorMapInput = {
      points: [single.points[0]!, { id: 'b', name: 'B', longitude: 118.123456789, latitude: 32 }],
      representative: 'b',
      route: ['b', 'a', 'b'],
      zoom: -100,
    };
    expect(roundTrip(stringify({ map }))).toMatchObject({ ok: true, map });
  });

  it('preserves Chinese, quotes, multiline names, whitespace and long decimals', () => {
    const map: AuthorMapInput = {
      points: [
        {
          id: 'a',
          name: '  一 "二" \'三\': #四\n五  ',
          longitude: 118.12345678912345,
          latitude: -32.12345678912345,
        },
      ],
    };
    const out = roundTrip(stringify({ map }));
    expect(out).toMatchObject({ ok: true, map });
    if (!out.ok) throw new Error('Expected valid export');
    expect(importAuthorYaml(out.yaml)).toEqual({ ok: true, map });
  });

  it.each([
    { source: 'walk.gpx' },
    { source: 'walk.geojson', privacy: {} },
    { source: 'walk.json', privacy: { trim_start_meters: 12 } },
    { source: 'walk.gpx', privacy: { trim_end_meters: 7 }, playback: false },
    {
      source: 'walk.gpx',
      privacy: { trim_start_meters: 0, trim_end_meters: 0 },
      simplify_tolerance_meters: 5,
      playback: true,
    },
    {
      source: 'walk.gpx',
      privacy: { trim_start_meters: 10.25, trim_end_meters: 2 },
      simplify_tolerance_meters: 0,
      playback: false,
    },
  ])('preserves track optional fields exactly: %j', (track) => {
    const map = { ...single, track };
    const out = roundTrip(stringify({ map }));
    expect(out).toMatchObject({ ok: true });
    if (!out.ok) throw new Error('Expected valid export');
    expect(out.map.track).toEqual(track);
    expect(importAuthorYaml(out.yaml)).toEqual({ ok: true, map });
  });

  it.each([
    ['root unknown field', `${source}title: A\n`],
    ['map unknown field', `${source}  extra: A\n`],
    ['point unknown field', source.replace('id: a', 'extra: A, id: a')],
    ['track unknown field', `${source}  track: { source: walk.gpx, extra: A }\n`],
    ['privacy unknown field', `${source}  track: { source: walk.gpx, privacy: { extra: 1 } }\n`],
    ['whole article', `---\ntitle: A\n${source}---\nA\n`],
    ['second document', `${source}---\n${source}`],
    ['duplicate root key', `${source}${source}`],
    ['duplicate point key', source.replace('id: a', 'id: a, id: b')],
    ['custom tag', source.replace('name: A', 'name: !custom A')],
    ['known non-core tag', source.replace('name: A', 'name: !!binary QQ==')],
    ['merge key', `${source}  <<: { zoom: 10 }\n`],
    ['quoted merge key', `${source}  "<<": { zoom: 10 }\n`],
    ['cyclic alias', 'map: &loop { points: *loop }\n'],
    ['unknown alias', `${source}  route: [*missing, a]\n`],
    ['missing map', 'points: []\n'],
    ['empty map', 'map: {}\n'],
    ['empty input', ''],
    ['sequence root', '- map: {}\n'],
    ['complex key', '? [map]\n: {}\n'],
    ['empty points', 'map: { points: [] }\n'],
    [
      'multiple points without representative',
      source + '    - { id: b, name: B, longitude: 118, latitude: 32 }\n',
    ],
    ['unknown representative', `${source}  representative: missing\n`],
    ['unknown route reference', `${source}  route: [a, missing]\n`],
    ['one route stop', `${source}  route: [a]\n`],
    ['duplicate point id', source + '    - { id: a, name: B, longitude: 118, latitude: 32 }\n'],
    ['nonfinite longitude', source.replace('118.123456789', '.inf')],
    ['nonfinite latitude', source.replace('latitude: 32', 'latitude: .nan')],
    ['nonfinite zoom', `${source}  zoom: -.inf\n`],
    [
      'nonfinite track setting',
      `${source}  track: { source: walk.gpx, simplify_tolerance_meters: .nan }\n`,
    ],
  ])('rejects %s without a partial map', (_name, input) => rejected(input));

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects dangerous key %s without prototype mutation',
    (key) => {
      const before = Object.getOwnPropertyDescriptors(Object.prototype);
      rejected(`${source}  ${key}: { polluted: true }\n`);
      rejected(source.replace('name: A', `name: A, ${key}: { polluted: true }`));
      expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before);
    },
  );

  it('allows harmless scalar aliases within the expansion limit', () => {
    const input = `${source.replace('id: a', 'id: &point a')}  route: [*point, *point]\n`;
    expect(roundTrip(input)).toMatchObject({ ok: true, map: { route: ['a', 'a'] } });
  });

  it('allows standard YAML tags on valid map fields', () => {
    const input = source
      .replace('name: A', 'name: !!str A')
      .replace('latitude: 32', 'latitude: !!float 32.0');
    expect(roundTrip(input)).toMatchObject({ ok: true, map: single });
  });

  it('allows repeated aliases at the parser expansion boundary', () => {
    const input = `${source.replace('id: a', 'id: &point a')}  route: [${Array<string>(49).fill('*point').join(', ')}]\n`;
    const result = importAuthorYaml(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected valid import');
    expect(result.map.route).toHaveLength(49);
  });

  it('rejects more than 50 expansions and nested alias amplification', () => {
    rejected(
      `${source.replace('id: a', 'id: &point a')}  route: [${Array<string>(51).fill('*point').join(', ')}]\n`,
    );
    rejected(
      'map: &a [A]\nx: &b [*a, *a, *a, *a, *a, *a, *a, *a]\ny: [*b, *b, *b, *b, *b, *b, *b, *b]\n',
    );
  });

  it('accepts exactly 131072 UTF-8 input bytes and rejects one additional byte', () => {
    const input = `${source}#${'x'.repeat(131072 - new TextEncoder().encode(source).length - 1)}`;
    expect(new TextEncoder().encode(input)).toHaveLength(131072);
    expect(importAuthorYaml(input).ok).toBe(true);
    rejected(`${input}x`);
  });

  it('measures multibyte input by UTF-8 bytes instead of string length', () => {
    const input = `${source}#${'一'.repeat(45000)}`;
    expect(input.length).toBeLessThan(131072);
    rejected(input);
  });

  it('accepts 200 points and 1000 route stops without truncation', () => {
    const map: AuthorMapInput = {
      points: Array.from({ length: 200 }, (_, i) => ({
        id: `p-${i}`,
        name: `P${i}`,
        longitude: 118,
        latitude: 32,
      })),
      representative: 'p-0',
      route: Array<string>(1000).fill('p-0'),
    };
    const out = roundTrip(stringify({ map }));
    expect(out).toMatchObject({ ok: true, map });
    if (!out.ok) throw new Error('Expected valid export');
    expect(out.map.points).toHaveLength(200);
    expect(out.map.route).toHaveLength(1000);
    rejected(
      stringify({
        map: {
          ...map,
          points: [...map.points, { id: 'p-200', name: 'P200', longitude: 118, latitude: 32 }],
        },
      }),
    );
    rejected(stringify({ map: { ...map, route: [...map.route!, 'p-0'] } }));
  });

  it('returns fixed issues without reflecting invalid input or paths', () => {
    for (const input of [
      source + '  representative: private-name\n',
      source + '  "private-name": A\n',
      source.replace('name: A', 'name: !private-name A'),
    ]) {
      const result = importAuthorYaml(input);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('private-name');
    }
  });

  it('exports the current revision without mutating or sharing the draft', () => {
    const draft = setAuthorRoute(updateAuthorPoint(createAuthorDraft(single), 'a', { name: 'B' }), [
      'a',
      'a',
    ]);
    const before = structuredClone(draft);
    const out = exportAuthorYaml(draft);
    expect(out).toMatchObject({ ok: true, revision: 2 });
    if (!out.ok) throw new Error('Expected valid export');
    out.map.points[0]!.name = 'Changed';
    expect(draft).toEqual(before);
  });

  it('returns issues for empty and temporarily invalid drafts', () => {
    for (const draft of [
      createAuthorDraft(),
      updateAuthorPoint(createAuthorDraft(single), 'a', { name: '' }),
      setAuthorRoute(createAuthorDraft(single), ['a']),
      { ...createAuthorDraft(single), representativeMode: 'pending' } as AuthorDraft,
    ]) {
      const out = exportAuthorYaml(draft);
      expect(out.ok).toBe(false);
      expect(out).not.toHaveProperty('yaml');
      expect(out).not.toHaveProperty('map');
    }
  });

  it('checks output UTF-8 bytes and never returns oversized YAML', () => {
    const overhead =
      new TextEncoder().encode(
        stringify({ map: { ...single, points: [{ ...single.points[0]!, name: 'x' }] } }),
      ).length - 1;
    const exact = createAuthorDraft({
      ...single,
      points: [{ ...single.points[0]!, name: 'x'.repeat(131072 - overhead) }],
    });
    const out = exportAuthorYaml(exact);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('Expected valid export');
    expect(new TextEncoder().encode(out.yaml)).toHaveLength(131072);
    for (const name of ['x'.repeat(131073 - overhead), '一'.repeat(45000)]) {
      const result = exportAuthorYaml(
        createAuthorDraft({ ...single, points: [{ ...single.points[0]!, name }] }),
      );
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty('yaml');
    }
  });
});
