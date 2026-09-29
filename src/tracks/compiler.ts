import { createHash } from 'node:crypto';

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
  return {
    compile(postSource: string, reference: NormalizedTrackReference): CompiledTrack {
      // Revalidate and read securely on every call, including cache hits.
      const file = readTrackSource(sourceDir, postSource, reference.source);
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
      if (cached?.fingerprint === file.fingerprint) return cached.compiled;
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
