import type Hexo from 'hexo';
import type { AuthorBrowserOptions } from '../author/open-browser';
import type { AuthorServerHandle } from '../author/server';

export interface AuthorSessionOptions {
  port: number;
  rawConfig: unknown;
  env: NodeJS.ProcessEnv;
}

export interface AuthorSessionModule {
  startAuthorSession(options: AuthorSessionOptions): Promise<AuthorServerHandle>;
  openAuthorBrowser?: typeof import('../author/open-browser').openAuthorBrowser;
}

export function parseAuthorPort(args: Record<string, unknown>): number {
  if (Object.hasOwn(args, 'host')) {
    throw new Error('[hexo-post-map] --host is not supported; the editor binds to 127.0.0.1.');
  }
  if (!Object.hasOwn(args, 'port')) return 4001;
  const raw = args.port;
  const port =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() === raw && /^[0-9]+$/u.test(raw)
        ? Number(raw)
        : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('[hexo-post-map] --port must be a decimal integer from 1 to 65535.');
  }
  return port;
}

function parseAuthorOpen(args: Record<string, unknown>): boolean {
  if (!Object.hasOwn(args, 'open')) return false;
  if (typeof args.open !== 'boolean') {
    throw new Error('[hexo-post-map] --open must be a single boolean flag without a value.');
  }
  return args.open;
}

async function loadAuthorSession(): Promise<AuthorSessionModule> {
  // External in dist/index.cjs: this sibling bundle is loaded only by the command.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./author/server.cjs') as AuthorSessionModule;
}

export function registerAuthorCommand(
  instance: Hexo,
  load: () => Promise<AuthorSessionModule> = loadAuthorSession,
  browser: Omit<AuthorBrowserOptions, 'signal'> = {},
): void {
  instance.extend.console.register(
    'post-map-editor',
    'Open the local map editor without loading or generating posts.',
    {
      usage: '[--open] [--port 4001]',
      options: [
        { name: '--port', desc: 'Loopback port, decimal integer 1–65535 (default: 4001).' },
        { name: '--open', desc: 'Open this editor session in the default browser.' },
      ],
    },
    async (args) => {
      // Hexo CLI's minimist coerces exponent/hex/dotted values before our callback.
      // Inspect argv only for this actual host invocation, never for internal calls.
      if (instance.env.cmd === 'post-map-editor' && instance.env.args === args) {
        const rawArgs = process.argv.slice(2);
        if (rawArgs.includes('post-map-editor')) {
          let seenOpen = false;
          for (let index = 0; index < rawArgs.length && rawArgs[index] !== '--'; index += 1) {
            const raw = rawArgs[index]!;
            if (raw === '--port') parseAuthorPort({ port: rawArgs[++index] });
            else if (raw.startsWith('--port=')) parseAuthorPort({ port: raw.slice(7) });
            else if (
              raw === '--open' ||
              raw === '--no-open' ||
              raw.startsWith('--open=') ||
              raw.startsWith('--no-open=')
            ) {
              const next = rawArgs[index + 1];
              if (
                seenOpen ||
                raw.includes('=') ||
                (next !== undefined && next !== '--' && !next.startsWith('-'))
              ) {
                throw new Error(
                  '[hexo-post-map] --open must be a single boolean flag without a value.',
                );
              }
              seenOpen = true;
            }
          }
        }
      }
      const port = parseAuthorPort(args);
      const shouldOpen = parseAuthorOpen(args);
      let authorModule: AuthorSessionModule;
      let session: AuthorServerHandle;
      try {
        authorModule = await load();
        session = await authorModule.startAuthorSession({
          port,
          rawConfig: instance.config.post_map,
          env: process.env,
        });
      } catch (error) {
        // Underlying config/network errors can contain credentials; never forward them.
        if (error instanceof Error && 'code' in error && error.code === 'HPM_AUTHOR_PORT_IN_USE') {
          throw new Error(
            `[hexo-post-map] Port ${port} is already in use; choose another port with --port.`,
          );
        }
        throw new Error(`[hexo-post-map] Unable to start map editor on 127.0.0.1:${port}.`);
      }
      const browserOwnership = new AbortController();
      const revokeBrowser = () => browserOwnership.abort();
      void session.closed.then(revokeBrowser, revokeBrowser);
      let closing: Promise<void> | undefined;
      const close = () => {
        revokeBrowser();
        return (closing ??= session.close());
      };
      const terminate = () => {
        void close();
      };
      instance.extend.filter.register('before_exit', close);
      process.on('SIGTERM', terminate);
      // Hexo owns SIGINT and calls before_exit; preserve its handler and all other listeners.
      try {
        instance.log.info(session.url);
        instance.log.info('Press Ctrl+C to stop the map editor.');
        if (shouldOpen) {
          const reportOpenFailure = () => {
            if (!browserOwnership.signal.aborted) {
              instance.log.warn(
                '[hexo-post-map] Unable to open the browser automatically; open the URL above manually.',
              );
            }
          };
          // Observe OS handoff without waiting for the application to exit.
          // Editor lifetime belongs only to session.closed.
          void Promise.resolve()
            .then(() => {
              if (browserOwnership.signal.aborted) return false;
              const open = authorModule.openAuthorBrowser;
              return typeof open === 'function'
                ? open(session.url, { ...browser, signal: browserOwnership.signal })
                : false;
            })
            .then((opened) => {
              if (!opened) reportOpenFailure();
            }, reportOpenFailure);
        }
        await session.closed;
      } finally {
        revokeBrowser();
        process.removeListener('SIGTERM', terminate);
        instance.extend.filter.unregister('before_exit', close);
      }
    },
  );
}
