import type Hexo from 'hexo';
import { ConfigValidationError, resolveConfig } from '../config/resolve';
import { createTrackCompiler } from '../tracks/compiler';
import { createOverviewRoutes } from './generator';
import { injectBrowserRuntime } from './injector';
import { createPostFilter } from './post-filter';
import { postMapTag } from './tag';
import { createTrackAssetGuard } from './track-assets';

export function registerPlugin(instance: Hexo): void {
  let config: ReturnType<typeof resolveConfig>;
  try {
    config = resolveConfig(instance.config.post_map, process.env);
  } catch (error) {
    if (!(error instanceof ConfigValidationError)) throw error;
    // Hexo logs and swallows plugin-load errors. Fail inside its build lifecycle instead.
    instance.extend.filter.register('before_generate', () => {
      throw error;
    });
    return;
  }
  if (config === null) return;

  const compiler = createTrackCompiler(instance.source_dir);
  const trackAssetGuard = createTrackAssetGuard(instance, config, compiler);
  instance.extend.filter.register('before_generate', () => compiler.beginGeneration(), 1);
  instance.extend.filter.register(
    'before_generate',
    () => trackAssetGuard.invalidateTrackedPosts(),
    5,
  );
  instance.extend.filter.register('before_generate', () => trackAssetGuard.prepare(), 100);
  instance.extend.filter.register('after_generate', () => trackAssetGuard.afterGeneration(), 100);
  instance.extend.tag.register('post_map', postMapTag);
  instance.extend.filter.register(
    'after_post_render',
    createPostFilter(config, compiler, instance.config.root),
  );
  instance.extend.filter.register('after_render:html', (html: string) =>
    injectBrowserRuntime(html, instance.config.root),
  );
  instance.extend.generator.register('post-map', (locals) =>
    createOverviewRoutes(locals, config, instance, compiler),
  );
}
