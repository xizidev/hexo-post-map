import { execFileSync } from 'node:child_process';
import {
  closeSync,
  ftruncateSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TrackBuildError } from '../../src/tracks/errors';
import { createTrackSourceReader, readTrackSource } from '../../src/tracks/source';

describe('readTrackSource', () => {
  let temporary: string;
  let sourceDir: string;
  const postSource = '_posts/trip.md';

  beforeEach(() => {
    temporary = mkdtempSync(join(tmpdir(), 'post-map-source-'));
    sourceDir = join(temporary, 'source');
    mkdirSync(join(sourceDir, '_posts/tracks'), { recursive: true });
  });

  afterEach(() => rmSync(temporary, { recursive: true, force: true }));

  it.each([
    ['trip.gpx', 'gpx'],
    ['trip.GPX', 'gpx'],
    ['trip.geojson', 'geojson'],
    ['trip.json', 'geojson'],
  ])('reads %s relative to the article directory', (name, format) => {
    const target = join(sourceDir, '_posts/tracks', name);
    writeFileSync(target, '私密文件内容');
    const file = readTrackSource(sourceDir, postSource, `./tracks/${name}`);
    expect(file.format).toBe(format);
    expect(file.bytes.toString('utf8')).toBe('私密文件内容');
    expect(file.canonicalPath).toBe(realpathSync(target));
    expect(file.fingerprint).toEqual(expect.any(String));
    expect(file.fingerprint.length).toBeGreaterThan(0);
    expect(file.fingerprint).not.toContain('私密文件内容');
    expect(readTrackSource(sourceDir, postSource, `tracks/${name}`).fingerprint).toBe(
      file.fingerprint,
    );
    writeFileSync(target, 'changed contents and size');
    expect(readTrackSource(sourceDir, postSource, `tracks/${name}`).fingerprint).not.toBe(
      file.fingerprint,
    );
  });

  it.each([
    'https://example.com/trip.gpx',
    'http://example.com/trip.gpx',
    '//example.com/trip.gpx',
    '/tmp/trip.gpx',
    'C:\\tracks\\trip.gpx',
    'file:trip.gpx',
    'tracks/\0trip.gpx',
    '../trip.gpx',
    'tracks/../../trip.gpx',
    'tracks/../trip.gpx',
    'tracks\\..\\trip.gpx',
    'tracks/trip.txt',
    'tracks/trip.gpx?query',
    '',
    'tracks/missing.gpx',
  ])('rejects unsafe or missing source %j with a redacted contextual error', (source) => {
    expect(() => readTrackSource(sourceDir, postSource, source)).toThrow(TrackBuildError);
    expect(() => readTrackSource(sourceDir, postSource, source)).toThrow(
      /_posts\/trip\.md: map\.track\.source:/,
    );
    expect(() => readTrackSource(sourceDir, postSource, source)).not.toThrow(/私密文件内容/);
  });

  it('rejects directories', () => {
    mkdirSync(join(sourceDir, '_posts/tracks/directory.gpx'));
    expect(() => readTrackSource(sourceDir, postSource, 'tracks/directory.gpx')).toThrow(
      /regular file/,
    );
  });

  it.skipIf(process.platform === 'win32')('rejects a FIFO without opening it', () => {
    execFileSync('mkfifo', [join(sourceDir, '_posts/tracks/pipe.gpx')]);
    expect(() => readTrackSource(sourceDir, postSource, 'tracks/pipe.gpx')).toThrow(/regular file/);
  });

  it('rejects symlink targets outside the canonical source root, including prefix siblings', () => {
    const sibling = join(temporary, 'source-private');
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'trip.gpx'), 'PRIVATE_TRACK_CONTENT');
    symlinkSync(join(sibling, 'trip.gpx'), join(sourceDir, '_posts/tracks/escape.gpx'));
    expect(() => readTrackSource(sourceDir, postSource, 'tracks/escape.gpx')).toThrow(
      /source directory/,
    );
    expect(() => readTrackSource(sourceDir, postSource, 'tracks/escape.gpx')).not.toThrow(
      /PRIVATE_TRACK_CONTENT/,
    );
  });

  it('canonicalizes a symlinked source root and accepts an internal file symlink', () => {
    writeFileSync(join(sourceDir, '_posts/tracks/trip.gpx'), 'safe');
    symlinkSync(join(sourceDir, '_posts/tracks/trip.gpx'), join(sourceDir, '_posts/alias.gpx'));
    const aliasRoot = join(temporary, 'alias-root');
    symlinkSync(sourceDir, aliasRoot);
    expect(readTrackSource(aliasRoot, postSource, 'alias.gpx').bytes.toString()).toBe('safe');
  });

  it('rejects a symlink disguising an unsupported target extension', () => {
    writeFileSync(join(sourceDir, '_posts/tracks/private.txt'), 'private');
    symlinkSync('private.txt', join(sourceDir, '_posts/tracks/alias.gpx'));
    expect(() => readTrackSource(sourceDir, postSource, 'tracks/alias.gpx')).toThrow(/extension/);
  });

  it('accepts exactly 8 MiB and rejects a larger sparse file before reading', () => {
    const target = join(sourceDir, '_posts/tracks/large.gpx');
    const descriptor = openSync(target, 'w');
    try {
      ftruncateSync(descriptor, 8 * 1024 * 1024);
      expect(readTrackSource(sourceDir, postSource, 'tracks/large.gpx').bytes.length).toBe(8388608);
      ftruncateSync(descriptor, 8 * 1024 * 1024 + 1);
      expect(() => readTrackSource(sourceDir, postSource, 'tracks/large.gpx')).toThrow(/8 MiB/);
    } finally {
      closeSync(descriptor);
    }
  });

  it.each(['realpath', 'stat', 'open', 'read'])(
    'rejects a parent replaced at %s without returning outside bytes or leaking descriptors',
    (phase) => {
      const parent = join(sourceDir, '_posts/tracks');
      const target = join(parent, 'trip.gpx');
      const outside = join(temporary, 'outside');
      mkdirSync(outside);
      writeFileSync(target, 'INSIDE');
      writeFileSync(join(outside, 'trip.gpx'), 'PRIVATE_OUTSIDE');
      const canonicalTarget = realpathSync(target);
      let replaced = false;
      let readBytes = 0;
      const descriptors = new Set<number>();
      const replace = () => {
        if (replaced) return;
        replaced = true;
        renameSync(parent, join(sourceDir, '_posts/original-tracks'));
        symlinkSync(outside, parent);
      };
      const read = createTrackSourceReader({
        realpathSync: ((...args: Parameters<typeof realpathSync>) => {
          const result = realpathSync(...args);
          if (phase === 'realpath' && String(args[0]) === target) replace();
          return result;
        }) as typeof realpathSync,
        statSync: ((...args: Parameters<typeof statSync>) => {
          if (phase === 'stat' && String(args[0]) === canonicalTarget) replace();
          return statSync(...args);
        }) as typeof statSync,
        openSync: (...args: Parameters<typeof openSync>) => {
          const descriptor = openSync(...args);
          descriptors.add(descriptor);
          if (phase === 'open' && String(args[0]) === canonicalTarget) replace();
          return descriptor;
        },
        closeSync: (descriptor) => {
          closeSync(descriptor);
          descriptors.delete(descriptor);
        },
        readFileSync: ((...args: Parameters<typeof readFileSync>) => {
          const result = readFileSync(...args);
          readBytes += result.length;
          return result;
        }) as typeof readFileSync,
        readSync: ((...args: Parameters<typeof readSync>) => {
          const count = readSync(...args);
          readBytes += count;
          if (phase === 'read') replace();
          return count;
        }) as typeof readSync,
      });
      expect(() => read(sourceDir, postSource, 'tracks/trip.gpx')).toThrow(TrackBuildError);
      expect(replaced).toBe(true);
      expect(readBytes).toBe(phase === 'read' ? 6 : 0);
      expect(descriptors.size).toBe(0);
    },
  );

  it('physically bounds reads to MAX+1 when the opened file grows before reading', () => {
    const maximum = 8 * 1024 * 1024;
    const target = join(sourceDir, '_posts/tracks/growing.gpx');
    writeFileSync(target, 'small initial file');
    let grown = false;
    let readBytes = 0;
    const read = createTrackSourceReader({
      fstatSync: ((...args: Parameters<typeof fstatSync>) => {
        const result = fstatSync(...args);
        if (result.isFile() && !grown) {
          grown = true;
          const writer = openSync(target, 'r+');
          try {
            ftruncateSync(writer, maximum * 8);
          } finally {
            closeSync(writer);
          }
        }
        return result;
      }) as typeof fstatSync,
      readFileSync: ((...args: Parameters<typeof readFileSync>) => {
        const result = readFileSync(...args);
        readBytes += result.length;
        return result;
      }) as typeof readFileSync,
      readSync: ((...args: Parameters<typeof readSync>) => {
        const count = readSync(...args);
        readBytes += count;
        return count;
      }) as typeof readSync,
    });
    expect(() => read(sourceDir, postSource, 'tracks/growing.gpx')).toThrow(/8 MiB/);
    expect(grown).toBe(true);
    expect(readBytes).toBe(maximum + 1);
  });
});
