import type Hexo from 'hexo';
import type { AuthorServerHandle } from '../author/server';

export interface AuthorSessionOptions {
  port: number;
  rawConfig: unknown;
  env: NodeJS.ProcessEnv;
}

export interface AuthorSessionModule {
  startAuthorSession(options: AuthorSessionOptions): Promise<AuthorServerHandle>;
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

async function loadAuthorSession(): Promise<AuthorSessionModule> {
  // External in dist/index.cjs: this sibling bundle is loaded only by the command.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./author/server.cjs') as AuthorSessionModule;
}

export function registerAuthorCommand(
  instance: Hexo,
  load: () => Promise<AuthorSessionModule> = loadAuthorSession,
): void {
  instance.extend.console.register(
    'post-map-editor',
    'Open the local map editor without loading or generating posts.',
    {
      usage: '[--port 4001]',
      options: [
        { name: '--port', desc: 'Loopback port, decimal integer 1–65535 (default: 4001).' },
      ],
    },
    async (args) => {
      const port = parseAuthorPort(args);
      let session: AuthorServerHandle;
      try {
        session = await (
          await load()
        ).startAuthorSession({
          port,
          rawConfig: instance.config.post_map,
          env: process.env,
        });
      } catch {
        // Underlying config/network errors can contain credentials; never forward them.
        throw new Error(`[hexo-post-map] Unable to start map editor on 127.0.0.1:${port}.`);
      }
      let closing: Promise<void> | undefined;
      const close = () => (closing ??= session.close());
      const terminate = () => {
        void close();
      };
      instance.extend.filter.register('before_exit', close);
      process.on('SIGTERM', terminate);
      // Hexo owns SIGINT and calls before_exit; preserve its handler and all other listeners.
      try {
        instance.log.info(session.url);
        await session.closed;
      } finally {
        process.removeListener('SIGTERM', terminate);
        instance.extend.filter.unregister('before_exit', close);
      }
    },
  );
}
