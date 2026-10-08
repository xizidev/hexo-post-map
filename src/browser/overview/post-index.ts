import type { OverviewPost } from '../../templates/overview';
import { safeUrl } from '../../presentation/safe-html';
import type { OverviewPostIndex } from './exploration-types';

/** The URL parser drops empty userinfo, so check the original authority as well. */
export function hasUrlUserinfo(value: string): boolean {
  return /^https?:\/*[^/?#]*@/iu.test(value);
}

/** Preserve exact dataset references; URL parsing here only checks for userinfo. */
export function isSafePostReference(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    safeUrl(value, 'post') === null ||
    hasUrlUserinfo(value)
  ) {
    return false;
  }
  const url = new URL(value, 'https://overview.invalid');
  return url.username === '' && url.password === '';
}

export function createPostIndex(posts: readonly OverviewPost[]): OverviewPostIndex {
  const unique = new Map<string, OverviewPost>();
  const ambiguous = new Set<string>();
  for (const post of posts) {
    if (!isSafePostReference(post.url) || ambiguous.has(post.url)) continue;
    if (unique.has(post.url)) {
      unique.delete(post.url);
      ambiguous.add(post.url);
    } else {
      unique.set(post.url, post);
    }
  }
  return { unique, ambiguous };
}
