import {
  type BigIntStats,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';

import { TrackBuildError } from './errors';
import type { TrackSourceFile } from './types';

const maximumBytes = 8 * 1024 * 1024;
const fileSystem = {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
};

function isDescendant(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function formatOf(path: string): TrackSourceFile['format'] | undefined {
  switch (extname(path).toLowerCase()) {
    case '.gpx':
      return 'gpx';
    case '.geojson':
    case '.json':
      return 'geojson';
  }
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Internal filesystem injection for deterministic real-filesystem race tests. */
export function createTrackSourceReader(operations: Partial<typeof fileSystem> = {}) {
  const { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } = {
    ...fileSystem,
    ...operations,
  };
  return function readTrackSource(
    sourceDir: string,
    postSource: string,
    source: string,
  ): TrackSourceFile {
    const fail = (reason: string): never => {
      throw new TrackBuildError(postSource, reason);
    };
    if (
      !source.trim() ||
      source.includes('\0') ||
      source.includes('\\') ||
      isAbsolute(source) ||
      win32.isAbsolute(source) ||
      /^[a-z][a-z\d+.-]*:/i.test(source) ||
      source.split('/').includes('..')
    )
      fail('expected a relative local path without traversal');
    const format = formatOf(source);
    if (!format) return fail('unsupported track file extension');

    const directories: { path: string; descriptor: number; metadata: BigIntStats }[] = [];
    const pinDirectory = (path: string) => {
      if (realpathSync(path) !== path) fail('track source directory changed while being read');
      const metadata = lstatSync(path, { bigint: true });
      if (!metadata.isDirectory()) fail('track source directory changed while being read');
      const descriptor = openSync(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      directories.push({ path, descriptor, metadata });
      const opened = fstatSync(descriptor, { bigint: true });
      if (
        !opened.isDirectory() ||
        !sameIdentity(opened, metadata) ||
        opened.ctimeNs !== metadata.ctimeNs
      ) {
        fail('track source directory changed while being read');
      }
    };
    const verifyDirectories = () => {
      for (const { path, descriptor, metadata } of directories) {
        const opened = fstatSync(descriptor, { bigint: true });
        const current = lstatSync(path, { bigint: true });
        if (
          !current.isDirectory() ||
          !sameIdentity(opened, metadata) ||
          !sameIdentity(current, metadata) ||
          opened.ctimeNs !== metadata.ctimeNs ||
          current.ctimeNs !== metadata.ctimeNs ||
          realpathSync(path) !== path
        )
          fail('track source directory changed while being read');
      }
    };

    try {
      const root = realpathSync(sourceDir);
      pinDirectory(root);
      const target = resolve(dirname(resolve(sourceDir, postSource)), source);
      if (!isDescendant(resolve(sourceDir), target))
        fail('track must stay inside the source directory');
      const entry = lstatSync(target);
      if (!entry.isFile() && !entry.isSymbolicLink()) fail('track must be a regular file');
      const canonicalPath = realpathSync(target);
      if (!isDescendant(root, canonicalPath)) fail('track must stay inside the source directory');
      if (formatOf(canonicalPath) !== format)
        fail('track file extension does not match its target');

      let parent = root;
      for (const part of relative(root, dirname(canonicalPath)).split(sep).filter(Boolean)) {
        parent = resolve(parent, part);
        pinDirectory(parent);
      }
      const metadata = statSync(canonicalPath, { bigint: true });
      if (!metadata.isFile()) fail('track must be a regular file');
      if (metadata.size > maximumBytes) fail('track exceeds the 8 MiB limit');
      const descriptor = openSync(
        canonicalPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const opened = fstatSync(descriptor, { bigint: true });
        if (!opened.isFile()) fail('track must be a regular file');
        if (!sameIdentity(opened, metadata)) fail('track file changed while being read');
        if (opened.size > maximumBytes) fail('track exceeds the 8 MiB limit');
        const verifyOpenedPath = () => {
          verifyDirectories();
          const current = lstatSync(canonicalPath, { bigint: true });
          if (
            !current.isFile() ||
            !sameIdentity(current, opened) ||
            realpathSync(canonicalPath) !== canonicalPath
          ) {
            fail('track source directory changed while being read');
          }
        };
        // Bind the actual opened file to the pinned root/parent chain before any bytes are read.
        verifyOpenedPath();
        const buffer = Buffer.alloc(maximumBytes + 1);
        let length = 0;
        while (length < buffer.length) {
          const count = readSync(descriptor, buffer, length, buffer.length - length, length);
          if (count === 0) break;
          length += count;
          if (length > maximumBytes) fail('track exceeds the 8 MiB limit');
        }
        verifyOpenedPath();
        const after = fstatSync(descriptor, { bigint: true });
        if (
          !sameIdentity(after, opened) ||
          after.size !== opened.size ||
          after.mtimeNs !== opened.mtimeNs ||
          after.ctimeNs !== opened.ctimeNs
        ) {
          fail('track file changed while being read');
        }
        return {
          format,
          bytes: Buffer.from(buffer.subarray(0, length)),
          canonicalPath,
          fingerprint: [opened.dev, opened.ino, opened.size, opened.mtimeNs, opened.ctimeNs].join(
            ':',
          ),
        };
      } finally {
        closeSync(descriptor);
      }
    } catch (error) {
      if (error instanceof TrackBuildError) throw error;
      return fail('cannot read local track file');
    } finally {
      for (const { descriptor } of directories.reverse()) closeSync(descriptor);
    }
  };
}

export const readTrackSource = createTrackSourceReader();
