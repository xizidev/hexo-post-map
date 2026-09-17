import type Hexo from 'hexo';
import { ConfigValidationError, resolveConfig } from '../config/resolve';
import { createOverviewRoutes } from './generator';
import { injectMarkedAssets } from './injector';
import { createPostFilter } from './post-filter';
import { postMapTag } from './tag';

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

  instance.extend.tag.register('post_map', postMapTag);
  instance.extend.filter.register('after_post_render', createPostFilter(config));
  instance.extend.filter.register('after_render:html', (html: string) =>
    injectMarkedAssets(html, instance.config.root),
  );
  instance.extend.generator.register('post-map', (locals) =>
    createOverviewRoutes(locals, config, instance),
  );
}
