import type Hexo from 'hexo';
import type { ResolvedPluginConfig } from '../config/types';
import { normalizePostMapDocument } from '../domain/normalize';
import type { createTrackCompiler } from '../tracks/compiler';
import type { HexoPostLike } from './post-filter';

interface SourceAsset {
  readonly source: string;
  readonly path?: string;
}

type CachedPost = Pick<HexoPostLike, 'source' | 'map'> & {
  content?: string;
  save(): PromiseLike<unknown>;
};

/** Filter raw assets before Router updates can start watch writes; recheck after generation. */
export function createTrackAssetGuard(
  hexo: Hexo,
  config: ResolvedPluginConfig,
  compiler: ReturnType<typeof createTrackCompiler>,
) {
  const blocked = new Set<string>();
  const wrapped = new WeakSet<object>();

  function trackedPosts(): CachedPost[] {
    if (!config.post.enabled) return [];
    const posts = hexo.locals.toObject().posts as { toArray(): unknown[] };
    return (posts.toArray() as CachedPost[]).filter(
      (post) => post.map !== null && typeof post.map === 'object' && 'track' in post.map,
    );
  }

  function blockRawRoutes(onlyRouted: boolean): void {
    let failed = false;
    const routed = new Set(hexo.route.list());
    for (const name of ['Asset', 'PostAsset']) {
      // Warehouse's generic document type omits these Hexo schema virtuals.
      for (const asset of hexo.model(name).toArray() as unknown as SourceAsset[]) {
        if (!asset.path) continue;
        const path = hexo.route.format(asset.path);
        if (onlyRouted && !routed.has(path)) continue;
        try {
          if (!compiler.isActiveSource(asset.source)) continue;
        } catch {
          // Quarantine this exact unresolved asset before rejecting the generation.
          failed = true;
        }
        blocked.add(path);
        // An Asset alias can collide with a real hash. Always block its raw generator output;
        // after generation restore only bytes actually produced by this generation's compiler.
        const canonical = onlyRouted ? compiler.activeAsset(path) : undefined;
        if (canonical === undefined) hexo.route.remove(path);
        else hexo.route.set(path, canonical);
      }
    }
    if (failed)
      throw new Error('[hexo-post-map] cannot verify raw asset source during track publication');
  }

  function filterResult(result: unknown): unknown {
    if (Array.isArray(result))
      return result.map(filterResult).filter((route) => route !== undefined);
    if (
      result !== null &&
      typeof result === 'object' &&
      'path' in result &&
      typeof result.path === 'string' &&
      blocked.has(hexo.route.format(result.path))
    )
      return undefined;
    return result;
  }

  return {
    async invalidateTrackedPosts(): Promise<void> {
      for (const post of trackedPosts()) {
        if (normalizePostMapDocument(post.map, post.source)?.track) {
          // Hexo's priority-10 render_post rebuilds this from _content through the usual pipeline.
          // Track-only file changes do not otherwise invalidate the parent Warehouse document.
          post.content = undefined;
          // Warehouse query results are copies: persist invalidation before render_post reads them.
          await post.save();
        }
      }
      hexo.locals.invalidate();
    },
    prepare(): void {
      blocked.clear();
      for (const post of trackedPosts()) {
        const document = normalizePostMapDocument(post.map, post.source);
        if (document?.track) compiler.compile(post.source, document.track);
      }
      blockRawRoutes(false);
      // Other plugins can replace the generator between builds. Wrap the current function once.
      const original = hexo.extend.generator.get('asset');
      if (typeof original !== 'function')
        throw new Error(
          '[hexo-post-map] cannot guard Hexo asset generator during track publication',
        );
      if (wrapped.has(original)) return;
      hexo.extend.generator.register('asset', async (locals) =>
        filterResult(await original.call(hexo, locals)),
      );
      wrapped.add(hexo.extend.generator.get('asset'));
    },
    afterGeneration(): void {
      blockRawRoutes(true);
    },
  };
}
