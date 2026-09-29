import type Hexo from 'hexo';
import type { ResolvedPluginConfig } from '../config/types';
import { normalizePostMapDocument } from '../domain/normalize';
import type { createTrackCompiler } from '../tracks/compiler';
import type { HexoPostLike } from './post-filter';

interface SourceAsset {
  readonly source: string;
  readonly path?: string;
}

/** Filter raw assets before Router updates can start watch writes; recheck after generation. */
export function createTrackAssetGuard(
  hexo: Hexo,
  config: ResolvedPluginConfig,
  compiler: ReturnType<typeof createTrackCompiler>,
) {
  const blocked = new Set<string>();
  const wrapped = new WeakSet<object>();

  function blockRawRoutes(onlyRouted: boolean): void {
    let failed = false;
    const routed = new Set(hexo.route.list());
    for (const name of ['Asset', 'PostAsset']) {
      // Warehouse's generic document type omits these Hexo schema virtuals.
      for (const asset of hexo.model(name).toArray() as unknown as SourceAsset[]) {
        if (!asset.path) continue;
        const path = hexo.route.format(asset.path);
        if (
          (onlyRouted && !routed.has(path)) ||
          /^hexo-post-map\/tracks\/[a-f0-9]{64}\.json$/u.test(path)
        )
          continue;
        try {
          if (!compiler.isActiveSource(asset.source)) continue;
        } catch {
          // Quarantine this exact unresolved asset before rejecting the generation.
          failed = true;
        }
        blocked.add(path);
        hexo.route.remove(path);
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
    prepare(): void {
      blocked.clear();
      if (config.post.enabled) {
        const posts = hexo.locals.toObject().posts as { toArray(): unknown[] };
        for (const value of posts.toArray()) {
          const post = value as HexoPostLike;
          if (post.map === null || typeof post.map !== 'object' || !('track' in post.map)) continue;
          const document = normalizePostMapDocument(post.map, post.source);
          if (document?.track) compiler.compile(post.source, document.track);
        }
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
