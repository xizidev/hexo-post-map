import { createReadStream, type ReadStream } from 'node:fs';
import { join } from 'node:path';
import type Hexo from 'hexo';
import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';
import type { ResolvedPluginConfig } from '../config/types';
import { normalizePostMap } from '../domain/normalize';
import { resolveRepresentativeImage } from '../presentation/image';
import { safeUrl } from '../presentation/safe-html';
import { serializeForHtmlScript } from '../presentation/serialize';
import { renderOverview, type OverviewPost } from '../templates/overview';
import { renderStandalone } from '../templates/standalone';
import { injectMarkedAssets } from './injector';

export type { OverviewPost } from '../templates/overview';

export interface OverviewSourcePost {
  readonly source: string;
  readonly title: string;
  readonly path?: string;
  readonly permalink: string;
  readonly date: { toISOString(): string | null };
  readonly published: boolean;
  readonly content: string;
  readonly map?: unknown;
  readonly thumbnail?: unknown;
}

export interface HexoRoute {
  path: string;
  data: string | (() => ReadStream) | { title: string; type: 'post-map-overview'; content: string };
  layout?: string[];
}

interface OverviewLocals {
  posts: { toArray(): unknown[] };
}

/** Compare decoded segments, never confusing a sibling prefix or encoded separator with root. */
function relativeToRoot(pathname: string, root: string): string | null {
  // Hexo's URL helper decodes percent escapes; keep ambiguous separators/escapes absolute.
  if (/%(?:2f|5c|25|3f|23)/iu.test(pathname)) return null;
  const rootSegments = root.replace(/\/+$/u, '').split('/');
  const segments = pathname.split('/');
  try {
    if (
      !rootSegments.every(
        (segment, index) =>
          decodeURIComponent(segment) === decodeURIComponent(segments[index] ?? ''),
      )
    )
      return null;
  } catch {
    return null;
  }
  return segments.slice(rootSegments.length).join('/');
}

/** Normalize internal routes with Hexo's helper, without double-prefixing an existing root. */
function publicUrl(raw: string, hexo: Hexo, kind: 'post' | 'image'): string {
  let path = raw;
  let suffix = '';
  const root = hexo.config.root;
  if (/^https?:/iu.test(raw)) {
    if (safeUrl(raw, kind) === null) return '';
    const url = new URL(raw);
    if (url.username || url.password) return '';
    if (url.origin !== new URL(hexo.config.url).origin) return raw;
    const internalPath = relativeToRoot(url.pathname, new URL(root, hexo.config.url).pathname);
    if (internalPath === null) return raw;
    path = internalPath;
    // Keep query/hash escapes intact instead of feeding them through Hexo's path encoder.
    suffix = url.search + url.hash;
  } else {
    if (
      /^[a-z][a-z\d+.-]*:/iu.test(raw) ||
      safeUrl(raw.startsWith('/') ? raw : `/${raw}`, kind) === null
    )
      return '';
    if (path.startsWith(root)) path = path.slice(root.length);
  }
  const helper = hexo.extend.helper.get('url_for');
  const resolved: unknown = Reflect.apply(helper, hexo, [path, { relative: false }]);
  return typeof resolved === 'string' ? (safeUrl(resolved + suffix, kind) ?? '') : '';
}

function publicImage(post: OverviewSourcePost, hexo: Hexo, placeholderUrl: string): string {
  const preferred = publicUrl(resolveRepresentativeImage(post), hexo, 'image');
  if (preferred) return preferred;

  // The presentation allowlist permits HTTP(S); the final site URL policy also rejects userinfo.
  // Remove rejected content candidates before retrying the shared image-priority resolver.
  const fragment = parseFragment(post.content);
  function removeRejectedSources(node: DefaultTreeAdapterMap['node']): void {
    if ('tagName' in node && node.tagName === 'img') {
      node.attrs = node.attrs.filter(
        (attribute) => attribute.name !== 'src' || publicUrl(attribute.value, hexo, 'image') !== '',
      );
    }
    if ('childNodes' in node) node.childNodes.forEach(removeRejectedSources);
  }
  removeRejectedSources(fragment);
  return (
    publicUrl(resolveRepresentativeImage({ content: serialize(fragment) }), hexo, 'image') ||
    placeholderUrl
  );
}

function assetRoutes(): HexoRoute[] {
  return ['post-map.js', 'overview-map.js', 'style.css', 'placeholder.svg'].map((name) => ({
    path: `hexo-post-map/assets/${name}`,
    // The published entry is dist/index.cjs; factories open a fresh stream for every route read.
    data: () => createReadStream(join(__dirname, 'assets', name)),
  }));
}

export function createOverviewRoutes(
  locals: OverviewLocals,
  config: ResolvedPluginConfig | null,
  hexo: Hexo,
): HexoRoute[] {
  if (config === null) return [];
  const assets = assetRoutes();
  if (!config.overview.enabled) return assets;

  const placeholderUrl = publicUrl('/hexo-post-map/assets/placeholder.svg', hexo, 'image');
  const posts: OverviewPost[] = [];
  for (const document of locals.posts.toArray()) {
    // Warehouse's Document type omits the schema properties exposed by Hexo at runtime.
    const post = document as OverviewSourcePost;
    if (!post.published) continue;
    const map = normalizePostMap(post.map, post.source);
    if (map === null) continue;
    const date = post.date.toISOString();
    if (date === null) throw new Error(`[hexo-post-map] Invalid post date: ${post.source}`);
    const representative = map.representative;
    posts.push({
      title: post.title,
      url: publicUrl(post.path ?? post.permalink, hexo, 'post'),
      date,
      image: publicImage(post, hexo, placeholderUrl),
      location: {
        name: representative.name,
        longitude: representative.coordinate[0],
        latitude: representative.coordinate[1],
      },
    });
  }
  posts.sort((a, b) => b.date.localeCompare(a.date));
  const dataPath = `${config.overview.path}posts.json`;
  const content = renderOverview({
    posts,
    config,
    dataUrl: publicUrl(dataPath, hexo, 'post'),
    placeholderUrl,
  });
  const page: HexoRoute = { path: `${config.overview.path}index.html`, data: '' };
  if (config.overview.layout === 'page' && hexo.theme.getView('page')) {
    page.layout = ['page'];
    page.data = { title: config.overview.title, type: 'post-map-overview', content };
  } else {
    // Direct routes bypass Hexo's HTML renderer and its after_render:html hook.
    page.data = injectMarkedAssets(
      renderStandalone(config.overview.title, content),
      hexo.config.root,
    );
  }
  return [page, { path: dataPath, data: serializeForHtmlScript({ version: 1, posts }) }, ...assets];
}
