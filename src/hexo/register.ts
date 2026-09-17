import type Hexo from 'hexo';
import { resolveConfig } from '../config/resolve';
import { injectMarkedAssets } from './injector';
import { createPostFilter } from './post-filter';
import { postMapTag } from './tag';

export function registerPlugin(instance: Hexo): void {
  const config = resolveConfig(instance.config.post_map, process.env);
  if (config === null) return;

  instance.extend.tag.register('post_map', postMapTag);
  instance.extend.filter.register('after_post_render', createPostFilter(config));
  instance.extend.filter.register('after_render:html', (html: string) =>
    injectMarkedAssets(html, instance.config.root),
  );
}
