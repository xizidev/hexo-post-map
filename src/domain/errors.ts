export class PostMapValidationError extends Error {
  constructor(
    readonly sourcePath: string,
    readonly fieldPath: string,
    readonly value: unknown,
    readonly reason: string,
  ) {
    super(`[hexo-post-map] ${sourcePath}: ${fieldPath}: ${reason}`);
    this.name = 'PostMapValidationError';
  }
}
