import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export type AuthorBrowserSpawn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export interface AuthorBrowserOptions {
  platform?: NodeJS.Platform;
  spawn?: AuthorBrowserSpawn;
  signal?: AbortSignal;
}

export async function openAuthorBrowser(
  url: string,
  options: AuthorBrowserOptions = {},
): Promise<boolean> {
  // Match the server's exact URL grammar before handing any string to the OS.
  const match =
    typeof url === 'string'
      ? /^http:\/\/127\.0\.0\.1(?::([1-9][0-9]{0,4}))?\/#session=[A-Za-z0-9_-]{43}$/u.exec(url)
      : null;
  if (!match || match[0] !== url || Number(match[1] ?? 80) > 65535) return false;
  if (new URL(url).href !== url) return false;

  let command: string;
  let args: string[];
  switch (options.platform ?? process.platform) {
    case 'darwin':
      command = '/usr/bin/open';
      args = [url];
      break;
    case 'linux':
      command = 'xdg-open';
      args = [url];
      break;
    case 'win32':
      command = 'rundll32.exe';
      args = ['url.dll,FileProtocolHandler', url];
      break;
    default:
      return false;
  }

  // An already-resolved session.closed promise must revoke ownership before spawn.
  await Promise.resolve();
  if (options.signal?.aborted) return false;

  return new Promise<boolean>((resolve) => {
    let child: ChildProcess;
    try {
      child = (options.spawn ?? spawn)(command, args, {
        shell: false,
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      });
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (opened: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      options.signal?.removeEventListener('abort', cancelObservation);
      child.removeListener('exit', onExit);
      resolve(opened);
    };
    const cancelObservation = () => finish(false);
    const onError = () => finish(false);
    const onExit = (code: number | null) => finish(code === 0);
    const onClose = (code: number | null) => {
      finish(code === 0);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    };
    // Retain one error guard until close, including after observation ends, so
    // a late OS error cannot become an unhandled EventEmitter error.
    child.on('error', onError);
    child.once('exit', onExit);
    child.once('close', onClose);
    options.signal?.addEventListener('abort', cancelObservation, { once: true });
    // Successful handlers may exec a long-lived browser. The deadline acknowledges
    // handoff only; neither timeout nor editor cancellation owns that application's life.
    const deadline = setTimeout(() => finish(true), 5000);
    deadline.unref();
    child.unref();
    if (options.signal?.aborted) cancelObservation();
  });
}
