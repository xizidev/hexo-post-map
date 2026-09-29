import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTrackCompiler } from '../../src/tracks/compiler';
import { TrackBuildError } from '../../src/tracks/errors';
import type { NormalizedTrackReference } from '../../src/tracks/types';

let sourceDir: string;
beforeEach(() => {
  sourceDir = mkdtempSync(join(tmpdir(), 'track-compiler-'));
  mkdirSync(join(sourceDir, '_posts'));
});
afterEach(() => rmSync(sourceDir, { recursive: true, force: true }));

const reference = (
  overrides: Partial<NormalizedTrackReference> = {},
): NormalizedTrackReference => ({
  source: 'private-route.geojson',
  privacy: { trimStartMeters: 0, trimEndMeters: 0 },
  simplifyToleranceMeters: 5,
  playback: true,
  ...overrides,
});
const writeLine = (
  coordinates: number[][],
  filename = 'private-route.geojson',
  name = 'PRIVATE_NAME',
) => {
  writeFileSync(
    join(sourceDir, '_posts', filename),
    JSON.stringify({
      type: 'Feature',
      properties: { name, coordTimes: ['PRIVATE_TIMESTAMP'], secret: 'PRIVATE_PROPERTY' },
      geometry: { type: 'LineString', coordinates },
    }),
  );
};
const gpx = (points: string) =>
  `<gpx xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>PRIVATE_NAME</name></metadata><trk><trkseg>${points}</trkseg></trk></gpx>`;

describe('privacy-first track compiler', () => {
  it('emits the exact version-1 canonical key order and content-addressed SHA-256 route', () => {
    writeLine([
      [0, 0, 10],
      [0.001, 0, 20],
    ]);
    const result = createTrackCompiler(sourceDir).compile('_posts/trip.md', reference());
    const expected =
      '{"version":1,"coordinateSystem":"wgs84","segments":[[[0,0,10],[0.001,0,20]]],"stats":{"distanceMeters":111.195,"elevationGainMeters":10}}';
    expect(result.serialized).toBe(expected);
    expect(result.routePath).toBe(
      `hexo-post-map/tracks/${createHash('sha256').update(expected, 'utf8').digest('hex')}.json`,
    );
    expect(result.routePath).toMatch(/^hexo-post-map\/tracks\/[a-f0-9]{64}\.json$/);
    expect(result.asset).toEqual(JSON.parse(expected));
    expect(result.stats).toBe(result.asset.stats);
    expect(result.playback).toBe(true);
    for (const value of [
      result,
      result.asset,
      result.stats,
      result.asset.segments,
      result.asset.segments[0],
      result.asset.segments[0]![0],
    ])
      expect(Object.isFrozen(value)).toBe(true);
  });

  it('trims both ends before statistics, simplification and hashing, and removes private metadata', () => {
    writeFileSync(
      join(sourceDir, '_posts', 'private-route.gpx'),
      gpx(
        [
          '<trkpt lon="0" lat="0"><ele>1000</ele><time>2026-01-01T00:00:00Z</time></trkpt>',
          '<trkpt lon="0.001" lat="0"><ele>10</ele><time>2026-01-01T00:00:10Z</time></trkpt>',
          '<trkpt lon="0.002" lat="0"><ele>20</ele><time>2026-01-01T00:00:20Z</time></trkpt>',
          '<trkpt lon="0.003" lat="0"><ele>2000</ele><time>2026-01-01T00:00:30Z</time></trkpt>',
        ].join(''),
      ),
    );
    const result = createTrackCompiler(sourceDir).compile(
      '_posts/trip.md',
      reference({
        source: 'private-route.gpx',
        privacy: { trimStartMeters: 111.1950802335329, trimEndMeters: 111.1950802335329 },
        simplifyToleranceMeters: 10000,
      }),
    );
    expect(result.asset.segments).toEqual([
      [
        [0.001, 0, 10],
        [0.002, 0, 20],
      ],
    ]);
    expect(result.stats).toEqual({
      distanceMeters: 111.195,
      elevationGainMeters: 10,
      durationSeconds: 10,
    });
    expect(result.serialized).toBe(
      '{"version":1,"coordinateSystem":"wgs84","segments":[[[0.001,0,10],[0.002,0,20]]],"stats":{"distanceMeters":111.195,"elevationGainMeters":10,"durationSeconds":10}}',
    );
    expect(result.serialized).not.toMatch(
      /private-route|PRIVATE_|2026-01-01|timeMilliseconds|source|properties|name/,
    );
  });

  it('calculates statistics before dropping a visible bend and an elevation peak', () => {
    writeLine([
      [0, 0, 0],
      [0.001, 0.001, 20],
      [0.002, 0, 0],
    ]);
    const compiler = createTrackCompiler(sourceDir);
    const low = compiler.compile('_posts/trip.md', reference({ simplifyToleranceMeters: 0 }));
    const high = compiler.compile('_posts/trip.md', reference({ simplifyToleranceMeters: 1000 }));
    expect(low.asset.segments[0]).toHaveLength(3);
    expect(high.asset.segments[0]).toHaveLength(2);
    expect(high.stats).toEqual({ distanceMeters: 314.507, elevationGainMeters: 20 });
    expect(low.stats).toEqual(high.stats);
    expect(low.routePath).not.toBe(high.routePath);
  });

  it('uses stable coordinate/elevation precision and removes negative zero', () => {
    writeLine([
      [-0.000000001, 0, 123.456789],
      [0.00123456789, 0, 123.456789],
    ]);
    const result = createTrackCompiler(sourceDir).compile('_posts/trip.md', reference());
    expect(result.asset.segments).toEqual([
      [
        [0, 0, 123.457],
        [0.0012346, 0, 123.457],
      ],
    ]);
    expect(result.serialized).not.toMatch(/null|NaN|Infinity|-0[,.\]]/);
  });

  it('deduplicates identical public output across filenames, metadata, playback and fresh compiler instances', () => {
    writeLine([
      [0, 0],
      [0.001, 0],
    ]);
    writeLine(
      [
        [0, 0],
        [0.001, 0],
      ],
      'second.geojson',
      'ANOTHER_PRIVATE_NAME',
    );
    const compiler = createTrackCompiler(sourceDir);
    const first = compiler.compile('_posts/trip.md', reference());
    const second = compiler.compile(
      '_posts/other.md',
      reference({ source: 'second.geojson', playback: false }),
    );
    expect(second.serialized).toBe(first.serialized);
    expect(second.routePath).toBe(first.routePath);
    expect(second.playback).toBe(false);
    expect(createTrackCompiler(sourceDir).compile('_posts/trip.md', reference()).routePath).toBe(
      first.routePath,
    );
    expect(first.serialized).not.toMatch(/private|PRIVATE|source|properties|coordTimes|playback/);
  });

  it('caches unchanged source/options and changes the digest when trim changes public bytes', () => {
    writeLine([
      [0, 0],
      [0.002, 0],
    ]);
    const compiler = createTrackCompiler(sourceDir);
    const original = compiler.compile('_posts/trip.md', reference());
    expect(compiler.compile('_posts/trip.md', reference())).toBe(original);
    const trimmed = compiler.compile(
      '_posts/trip.md',
      reference({ privacy: { trimStartMeters: 111.1950802335329, trimEndMeters: 0 } }),
    );
    expect(trimmed.asset.segments).toEqual([
      [
        [0.001, 0],
        [0.002, 0],
      ],
    ]);
    expect(trimmed.stats.distanceMeters).toBe(111.195);
    expect(trimmed.routePath).not.toBe(original.routePath);
  });

  it('invalidates on size changes, mtime changes, and same-size rewrites with restored mtime', () => {
    writeLine([
      [0, 0],
      [0.001, 0],
    ]);
    const compiler = createTrackCompiler(sourceDir);
    const path = join(sourceDir, '_posts', 'private-route.geojson');
    const first = compiler.compile('_posts/trip.md', reference());
    writeLine([
      [0, 0],
      [0.002, 0],
      [0.003, 0],
    ]);
    const sized = compiler.compile('_posts/trip.md', reference());
    expect(sized.stats.distanceMeters).toBe(333.585);
    expect(sized.routePath).not.toBe(first.routePath);
    const before = statSync(path);
    utimesSync(path, before.atime, new Date(before.mtimeMs + 2000));
    const touched = compiler.compile('_posts/trip.md', reference());
    expect(touched).not.toBe(sized);
    expect(touched.routePath).toBe(sized.routePath);
    const touchedMetadata = statSync(path);
    writeLine([
      [0, 0],
      [0.002, 0],
      [0.004, 0],
    ]);
    utimesSync(path, touchedMetadata.atime, touchedMetadata.mtime);
    expect(statSync(path).size).toBe(touchedMetadata.size);
    expect(compiler.compile('_posts/trip.md', reference()).stats.distanceMeters).toBe(444.78);
  });

  it('rebinds controlled parser failures to the current article without disclosing source bytes', () => {
    writeFileSync(join(sourceDir, '_posts', 'private-route.geojson'), '{PRIVATE_BYTES_TIMESTAMP');
    try {
      createTrackCompiler(sourceDir).compile('_posts/trip.md', reference());
      expect.fail('expected parser failure');
    } catch (error) {
      expect(error).toBeInstanceOf(TrackBuildError);
      expect(error).toMatchObject({ sourcePath: '_posts/trip.md', fieldPath: 'map.track.source' });
      expect(String(error)).not.toMatch(/PRIVATE_BYTES_TIMESTAMP|private-route/);
    }
  });

  it('preserves resolver diagnostics and binds privacy failures to their own field', () => {
    const compiler = createTrackCompiler(sourceDir);
    expect(() => compiler.compile('_posts/trip.md', reference())).toThrow(
      /_posts\/trip.md: map.track.source/,
    );
    writeLine([
      [0, 0],
      [0.001, 0],
    ]);
    expect(() =>
      compiler.compile(
        '_posts/trip.md',
        reference({ privacy: { trimStartMeters: 1000, trimEndMeters: 0 } }),
      ),
    ).toThrow(/_posts\/trip.md: map.track.privacy/);
  });

  it('rejects a track whose usable geometry disappears at public precision', () => {
    writeLine([
      [0, 0],
      [0.000000001, 0],
    ]);
    expect(() => createTrackCompiler(sourceDir).compile('_posts/trip.md', reference())).toThrow(
      TrackBuildError,
    );
  });
});
