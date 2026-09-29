import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { createTrackAsset } from './asset';
import { TrackBuildError } from './errors';
import { parseTrackSource } from './parse';
import { trimTrack } from './privacy';
import { simplifyTrack } from './simplify';
import { readTrackSource } from './source';
import { calculateTrackStats } from './statistics';
import type { CompiledTrack, NormalizedTrackReference } from './types';

export function createTrackCompiler(sourceDir: string) {
  // Only the most recent fingerprint for each path/options combination is retained.
  const cache = new Map<string, { fingerprint: string; compiled: CompiledTrack }>();
  const activeCanonicalPaths = new Set<string>();
  const activeEntryPaths = new Set<string>();
  const activeAssets = new Map<string, string>();
  return {
    /** A watch rebuild retains cached compilation, but only current sources stay private. */
    beginGeneration(): void {
      activeCanonicalPaths.clear();
      activeEntryPaths.clear();
      activeAssets.clear();
    },
    /** Only assets compiled in this generation can be restored as trusted publication data. */
    activeAsset(routePath: string): string | undefined {
      return activeAssets.get(routePath);
    },
    isActiveSource(source: string): boolean {
      if (activeCanonicalPaths.size === 0) return false;
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
      // Revalidate and read securely on every call, including cache hits.
      const file = readTrackSource(sourceDir, postSource, reference.source);
      activeCanonicalPaths.add(file.canonicalPath);
      activeEntryPaths.add(resolve(dirname(resolve(sourceDir, postSource)), reference.source));
      const { trimStartMeters, trimEndMeters } = reference.privacy;
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
