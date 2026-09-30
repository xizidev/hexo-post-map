import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import type { ResolvedPluginConfig } from '../config/types';
import { PostMapValidationError } from '../domain/errors';
import { normalizePostMapDocument } from '../domain/normalize';
import { safeUrl } from '../presentation/safe-html';
import type { DetailTrackDescriptor } from '../presentation/track';
import { renderDetailMap } from '../templates/detail';
import type { createTrackCompiler } from '../tracks/compiler';
import type { CompiledTrack } from '../tracks/types';
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

/** Hash routes contain only ASCII path bytes and must stay beneath the configured site root. */
function trackUrl(root: string, routePath: CompiledTrack['routePath']): string {
  const url = `${root.replace(/\/$/u, '')}/${routePath}`;
  if (!url.startsWith('/') || safeUrl(url, 'post') === null || /[?#]/u.test(url)) {
    throw new Error('[hexo-post-map] root must be a safe URL path without query or hash');
  }
  return url;
}

export function createPostFilter(
  config: ResolvedPluginConfig | null,
  compiler?: ReturnType<typeof createTrackCompiler>,
  root = '/',
) {
  return <T extends HexoPostLike>(post: T): T => {
    if (config === null) return post;

    const document = normalizePostMapDocument(post.map, post.source);
    const parts = post.content.split(POST_MAP_SENTINEL);
    if (parts.length > 2) {
      throw new PostMapValidationError(
        post.source,
        'post_map',
        parts.length - 1,
        'must contain at most one post_map tag',
      );
    }
    if (document === null || !config.post.enabled) {
      post.content = parts.join('');
      return post;
    }
    if (containsDetail(parseFragment(post.content))) {
      post.content = parts.join('');
      return post;
    }
    if (parts.length === 1 && config.post.position === 'manual') return post;

    let track: DetailTrackDescriptor | undefined;
    if (document.track) {
      if (!compiler)
        throw new Error('[hexo-post-map] track compiler is required for tracked posts');
      const compiled = compiler.compile(post.source, document.track);
      track = {
        url: trackUrl(root, compiled.routePath),
        stats: compiled.stats,
        playback: compiled.playback,
      };
    }
    const detail = renderDetailMap({ map: document.map, config, track });
    if (parts.length === 2) post.content = parts.join(detail);
    else if (config.post.position === 'before') post.content = detail + post.content;
    else post.content += detail;
    return post;
  };
}
