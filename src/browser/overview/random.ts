import type { OverviewPost } from '../../templates/overview';
import type { OverviewPostIndex } from './exploration-types';

export function chooseRandomPost(
  index: OverviewPostIndex,
  excludedUrl: string | undefined,
  rng: () => number,
): OverviewPost | undefined {
  const candidates = [...index.unique.values()].filter(
    (post) => index.unique.size < 2 || post.url !== excludedUrl,
  );
  if (candidates.length === 0) return undefined;
  try {
    const sample = rng();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) return undefined;
    return candidates[Math.floor(sample * candidates.length)];
  } catch {
    return undefined;
  }
}

export function randomTargetZoom(currentZoom: number, maxZoom: number): number {
  return Math.min(maxZoom, Math.max(currentZoom, 11));
}
