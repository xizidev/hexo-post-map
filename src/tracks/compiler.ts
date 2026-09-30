import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { createTrackAsset } from './asset';
import { TrackBuildError } from './errors';
import { parseTrackSource } from './parse';
import { trimTrack } from './privacy';
import { simplifyTrack } from './simplify';
import { readTrackSource, resolveTrackSourceEntry } from './source';
import { calculateTrackStats } from './statistics';
import type { CompiledTrack, NormalizedTrackReference } from './types';

export function createTrackCompiler(sourceDir: string) {
  // Only the most recent fingerprint for each path/options combination is retained.
  const cache = new Map<string, { fingerprint: string; compiled: CompiledTrack }>();
  const activeCanonicalPaths = new Set<string>();
  const activeEntryPaths = new Set<string>();
  const activeAssets = new Map<string, string>();
  const snapshots = new Map<string, CompiledTrack>();
  return {
    /** A watch rebuild retains cached compilation, but only current sources stay private. */
    beginGeneration(): void {
      activeCanonicalPaths.clear();
      activeEntryPaths.clear();
      activeAssets.clear();
      snapshots.clear();
    },
    /** Discover private input identities before any validation/parser can fail. No bytes are read. */
    discoverSource(postSource: string, source: string): void {
      const entry = resolveTrackSourceEntry(sourceDir, postSource, source);
      activeEntryPaths.add(entry);
      try {
        const canonical = realpathSync(entry);
        const path = relative(realpathSync(sourceDir), canonical);
        if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
          throw new TrackBuildError(postSource, 'track must stay inside the source directory');
        activeCanonicalPaths.add(canonical);
      } catch (error) {
        if (error instanceof TrackBuildError) throw error;
        throw new TrackBuildError(postSource, 'cannot read local track file');
      }
    },
    /** Includes earlier SSR snapshots even if later locals use different track options. */
    assetEntries(): [string, string][] {
      return [...activeAssets];
    },
    /** Only assets compiled in this generation can be restored as trusted publication data. */
    activeAsset(routePath: string): string | undefined {
      return activeAssets.get(routePath);
    },
    isActiveSource(source: string): boolean {
      if (activeCanonicalPaths.size === 0 && activeEntryPaths.size === 0) return false;
      const entry = resolve(source);
      // Remember both names so deleted files and broken author symlinks still match exactly.
      if (activeEntryPaths.has(entry) || activeCanonicalPaths.has(entry)) return true;
      try {
        return activeCanonicalPaths.has(realpathSync(entry));
      } catch {
        // A missing alias cannot safely be classified as unrelated to an active track.
        throw new Error('[hexo-post-map] cannot verify raw asset source during track publication');
      }
    },
    compile(postSource: string, reference: NormalizedTrackReference): CompiledTrack {
      const { trimStartMeters, trimEndMeters } = reference.privacy;
      const requestKey = JSON.stringify([
        postSource,
        reference.source,
        trimStartMeters,
        trimEndMeters,
        reference.simplifyToleranceMeters,
        reference.playback,
      ]);
      const snapshot = snapshots.get(requestKey);
      if (snapshot) return snapshot;
      // The first request in each generation revalidates securely, even on a fingerprint cache hit.
      const file = readTrackSource(sourceDir, postSource, reference.source);
      activeCanonicalPaths.add(file.canonicalPath);
      activeEntryPaths.add(resolveTrackSourceEntry(sourceDir, postSource, reference.source));
      const cacheKey = JSON.stringify([
        file.canonicalPath,
        file.format,
        trimStartMeters,
        trimEndMeters,
        reference.simplifyToleranceMeters,
        reference.playback,
      ]);
      const cached = cache.get(cacheKey);
      if (cached?.fingerprint === file.fingerprint) {
        activeAssets.set(cached.compiled.routePath, cached.compiled.serialized);
        snapshots.set(requestKey, cached.compiled);
        return cached.compiled;
      }
      try {
        const raw = parseTrackSource(file);
        const trimmed = trimTrack(raw, trimStartMeters, trimEndMeters);
        const stats = calculateTrackStats(trimmed);
        const segments = simplifyTrack(trimmed, reference.simplifyToleranceMeters, 2000);
        const asset = createTrackAsset(segments, stats);
        const serialized = JSON.stringify(asset);
        const digest = createHash('sha256').update(serialized, 'utf8').digest('hex');
        const compiled: CompiledTrack = Object.freeze({
          routePath: `hexo-post-map/tracks/${digest}.json`,
          serialized,
          asset,
          stats: asset.stats,
          playback: reference.playback,
        });
        cache.set(cacheKey, { fingerprint: file.fingerprint, compiled });
        activeAssets.set(compiled.routePath, compiled.serialized);
        snapshots.set(requestKey, compiled);
        return compiled;
      } catch (error) {
        if (error instanceof TrackBuildError) {
          throw new TrackBuildError(postSource, error.reason, error.fieldPath);
        }
        throw new TrackBuildError(postSource, 'cannot compile local track');
      }
    },
  };
}
