import type Hexo from 'hexo';

export function registerPlugin(instance: Hexo): void {
  instance.log.debug('[hexo-post-map] loaded');
}
