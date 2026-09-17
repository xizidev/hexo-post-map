import type { OverviewPost } from '../../templates/overview';

export interface Bounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export function sortPosts(posts: readonly OverviewPost[]): OverviewPost[] {
  return [...posts].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export function decideClusterAction(input: {
  zoom: number;
  maxZoom: number;
  posts: readonly OverviewPost[];
  bounds: Bounds;
}): { type: 'zoom'; bounds: Bounds } | { type: 'list'; posts: OverviewPost[] } {
  const { zoom, maxZoom, posts, bounds } = input;
  // A line may have zero area but still be separable; only a point is terminal.
  const identical = bounds.west === bounds.east && bounds.south === bounds.north;
  if (posts.length <= 1 || zoom >= maxZoom || identical)
    return { type: 'list', posts: sortPosts(posts) };
  return { type: 'zoom', bounds };
}
