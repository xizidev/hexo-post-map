import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';

import { TrackBuildError } from './errors';
import type { TrackSourceFile } from './types';

const maximumBytes = 8 * 1024 * 1024;

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

export function readTrackSource(
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
  ) {
    fail('expected a relative local path without traversal');
  }
  const format = formatOf(source);
  if (!format) return fail('unsupported track file extension');

  try {
    const root = realpathSync(sourceDir);
    const target = resolve(dirname(resolve(sourceDir, postSource)), source);
    // Check both boundaries: lexical paths cannot escape, nor can symlink targets.
    if (!isDescendant(resolve(sourceDir), target))
      fail('track must stay inside the source directory');
    const entry = lstatSync(target);
    if (!entry.isFile() && !entry.isSymbolicLink()) fail('track must be a regular file');
    const canonicalPath = realpathSync(target);
    if (!isDescendant(root, canonicalPath)) fail('track must stay inside the source directory');
    if (formatOf(canonicalPath) !== format) fail('track file extension does not match its target');
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
      if (opened.dev !== metadata.dev || opened.ino !== metadata.ino) {
        fail('track file changed while being read');
      }
      if (opened.size > maximumBytes) fail('track exceeds the 8 MiB limit');
      const bytes = readFileSync(descriptor);
      const after = fstatSync(descriptor, { bigint: true });
      if (bytes.length > maximumBytes) fail('track exceeds the 8 MiB limit');
      if (
        after.size !== opened.size ||
        after.mtimeNs !== opened.mtimeNs ||
        after.ctimeNs !== opened.ctimeNs
      ) {
        fail('track file changed while being read');
      }
      return {
        format,
        bytes,
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
  }
}
