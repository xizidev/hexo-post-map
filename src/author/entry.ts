import type { AuthorSessionOptions } from '../hexo/author-command';
import { resolveAuthorBootstrap } from './config';
import { startAuthorServer, type AuthorServerHandle } from './server';

export { openAuthorBrowser } from './open-browser';

export function startAuthorSession(options: AuthorSessionOptions): Promise<AuthorServerHandle> {
  return startAuthorServer({
    port: options.port,
    assetDirectory: __dirname,
    bootstrap: resolveAuthorBootstrap(options.rawConfig, options.env),
  });
}
