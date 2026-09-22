import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

import { safeUrl } from './safe-html';

export const PLACEHOLDER_IMAGE = '/hexo-post-map/assets/placeholder.svg';

export interface PostPresentationInput {
  /** Untrusted Front Matter value, if the post declares one. */
  readonly thumbnail?: unknown;
  /** Rendered post HTML, as supplied by Hexo after Markdown rendering. */
  readonly content: string;
}

type ParsedNode = DefaultTreeAdapterMap['node'];

function attributeValue(node: ParsedNode, name: string): string | undefined {
  if (!('tagName' in node)) {
    return undefined;
  }

  return node.attrs.find((attribute) => attribute.name === name)?.value;
}

function representativeImageSource(node: ParsedNode): string | undefined {
  if (!('tagName' in node)) {
    return undefined;
  }

  if (node.tagName === 'img') {
    return attributeValue(node, 'src');
  }

  const classNames = attributeValue(node, 'class')?.split(/\s+/) ?? [];
  return classNames.includes('live-photo') ? attributeValue(node, 'data-photo-src') : undefined;
}

function findFirstSafeImage(node: ParsedNode): string | null {
  const source = representativeImageSource(node);
  if (source !== undefined) {
    const safeSource = safeUrl(source, 'image');
    if (safeSource !== null) {
      return safeSource;
    }
  }

  if ('childNodes' in node) {
    for (const child of node.childNodes) {
      const source = findFirstSafeImage(child);
      if (source !== null) {
        return source;
      }
    }
  }

  return null;
}

/** Resolves one safe overview image from Front Matter, rendered content, or the bundled fallback. */
export function resolveRepresentativeImage(post: PostPresentationInput): string {
  if (typeof post.thumbnail === 'string') {
    const safeThumbnail = safeUrl(post.thumbnail, 'image');
    if (safeThumbnail !== null) {
      return safeThumbnail;
    }
  }

  return findFirstSafeImage(parseFragment(post.content)) ?? PLACEHOLDER_IMAGE;
}
