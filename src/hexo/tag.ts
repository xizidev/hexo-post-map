/** A comment survives Markdown rendering without creating visible placeholder content. */
export const POST_MAP_SENTINEL = '<!-- hexo-post-map:manual -->';

export function postMapTag(): string {
  return POST_MAP_SENTINEL;
}
