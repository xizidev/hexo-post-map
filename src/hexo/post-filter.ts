import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import type { ResolvedPluginConfig } from '../config/types';
import { PostMapValidationError } from '../domain/errors';
import { normalizePostMap } from '../domain/normalize';
import { renderDetailMap } from '../templates/detail';
import { POST_MAP_SENTINEL } from './tag';

export interface HexoPostLike {
  source: string;
  content: string;
  map?: unknown;
}

function containsDetail(node: DefaultTreeAdapterMap['node']): boolean {
  return (
    ('tagName' in node && node.attrs.some((attr) => attr.name === 'data-hpm-detail')) ||
    ('childNodes' in node && node.childNodes.some(containsDetail))
  );
}

export function createPostFilter(config: ResolvedPluginConfig | null) {
  return <T extends HexoPostLike>(post: T): T => {
    if (config === null) return post;

    const map = normalizePostMap(post.map, post.source);
    const parts = post.content.split(POST_MAP_SENTINEL);
    if (parts.length > 2) {
      throw new PostMapValidationError(
        post.source,
        'post_map',
        parts.length - 1,
        'must contain at most one post_map tag',
      );
    }
    if (map === null || !config.post.enabled) {
      post.content = parts.join('');
      return post;
    }
    if (containsDetail(parseFragment(post.content))) {
      post.content = parts.join('');
      return post;
    }
    if (parts.length === 1 && config.post.position === 'manual') return post;

    const detail = renderDetailMap({ map, config });
    if (parts.length === 2) post.content = parts.join(detail);
    else if (config.post.position === 'before') post.content = detail + post.content;
    else post.content += detail;
    return post;
  };
}
