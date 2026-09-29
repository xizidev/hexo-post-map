/** Contains only controlled diagnostics, never source bytes or raw parser errors. */
export class TrackBuildError extends Error {
  constructor(
    readonly sourcePath: string,
    readonly reason: string,
    readonly fieldPath = 'map.track.source',
  ) {
    super(`[hexo-post-map] ${sourcePath}: ${fieldPath}: ${reason}`);
    this.name = 'TrackBuildError';
  }
}
