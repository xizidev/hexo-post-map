import { ChildProcess, spawn as spawnProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAuthorBrowser, type AuthorBrowserSpawn } from '../../src/author/open-browser';

const SESSION_URL = 'http://127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function executor() {
  const child = new ChildProcess();
  const kill = vi.spyOn(child, 'kill').mockReturnValue(true);
  const unref = vi.spyOn(child, 'unref');
  const spawn = vi.fn<AuthorBrowserSpawn>(() => child);
  const exit = (code: number | null, signal: NodeJS.Signals | null = null) => {
    child.emit('exit', code, signal);
    child.emit('close', code, signal);
  };
  return { child, kill, unref, spawn, exit };
}

describe('author browser URL boundary', () => {
  it.each([
    'http://127.0.0.1:1/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'http://127.0.0.1:65535/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'http://127.0.0.1/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'http://127.0.0.1:4001/#session=aA0_-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ])('opens an exact canonical session URL %s', async (url) => {
    const launch = executor();
    const opened = openAuthorBrowser(url, { platform: 'darwin', spawn: launch.spawn });
    await Promise.resolve();
    expect(launch.spawn).toHaveBeenCalledExactlyOnceWith('/usr/bin/open', [url], {
      shell: false,
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    launch.exit(0);
    await expect(opened).resolves.toBe(true);
  });

  it.each(
    [
      '',
      undefined,
      null,
      4001,
      {},
      ['http://127.0.0.1:4001/'],
      'https://127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'HTTP://127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'file:///127.0.0.1/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://localhost:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://2130706433:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://0x7f000001:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://0177.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1.:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://[::1]:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://example.test:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://user@127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://user:pass@127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:0/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:65536/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:04001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:+4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:4001.0/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:4e3/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:80/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:4001//#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:4001/editor/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:4001/%2f#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:4001/../#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?x=1',
      'http://127.0.0.1:4001/?x=1#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:4001/?#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:4001/#token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=',
      'http://127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa+',
      'http://127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/',
      'http://127.0.0.1:4001/#session=%61aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:4001/',
      'http://127.0.0.1:4001#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ' http://127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ',
      'http://127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
      'http://127.0.0.1:4001/\n#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'http://127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&calc',
      'http://127.0.0.1:4001/#session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"&calc',
    ].map((url) => [url]),
  )('rejects unsafe input before executing any OS command %j', async (url) => {
    const launch = executor();
    await expect(
      openAuthorBrowser(url as string, { platform: 'win32', spawn: launch.spawn }),
    ).resolves.toBe(false);
    expect(launch.spawn).not.toHaveBeenCalled();
  });
});

describe('author browser platform launch', () => {
  it.each([
    ['darwin', '/usr/bin/open', [SESSION_URL]],
    ['linux', 'xdg-open', [SESSION_URL]],
    ['win32', 'rundll32.exe', ['url.dll,FileProtocolHandler', SESSION_URL]],
  ] as const)(
    'launches the %s default URL handler without a shell',
    async (platform, command, args) => {
      const launch = executor();
      const opened = openAuthorBrowser(SESSION_URL, { platform, spawn: launch.spawn });
      await Promise.resolve();
      expect(launch.spawn).toHaveBeenCalledExactlyOnceWith(command, args, {
        shell: false,
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      });
      expect(launch.unref).toHaveBeenCalledOnce();
      launch.exit(0);
      await expect(opened).resolves.toBe(true);
      expect(launch.kill).not.toHaveBeenCalled();
    },
  );

  it.each(['aix', 'freebsd', 'openbsd', 'sunos', 'android'] as const)(
    'fails safely on unsupported platform %s',
    async (platform) => {
      const launch = executor();
      await expect(openAuthorBrowser(SESSION_URL, { platform, spawn: launch.spawn })).resolves.toBe(
        false,
      );
      expect(launch.spawn).not.toHaveBeenCalled();
    },
  );

  it('contains a synchronous executor failure', async () => {
    const spawn = vi.fn<AuthorBrowserSpawn>(() => {
      throw new Error('private-OS-error');
    });
    await expect(openAuthorBrowser(SESSION_URL, { platform: 'linux', spawn })).resolves.toBe(false);
  });

  it('contains a process spawn failure and cleans its owned listeners', async () => {
    const launch = executor();
    const opened = openAuthorBrowser(SESSION_URL, { platform: 'linux', spawn: launch.spawn });
    await Promise.resolve();
    launch.child.emit('error', new Error('private-OS-error'));
    launch.child.emit('close', null, null);
    await expect(opened).resolves.toBe(false);
    expect(launch.child.listenerCount('error')).toBe(0);
    expect(launch.child.listenerCount('exit')).toBe(0);
    expect(launch.child.listenerCount('close')).toBe(0);
  });

  it.each([1, 2, null])('reports an unsuccessful launcher exit %j', async (code) => {
    const launch = executor();
    const opened = openAuthorBrowser(SESSION_URL, { platform: 'linux', spawn: launch.spawn });
    await Promise.resolve();
    launch.exit(code, code === null ? 'SIGTERM' : null);
    await expect(opened).resolves.toBe(false);
  });
});

describe('author browser launch ownership', () => {
  it('does not spawn after an already closed session', async () => {
    const launch = executor();
    const controller = new AbortController();
    controller.abort();
    await expect(
      openAuthorBrowser(SESSION_URL, {
        platform: 'darwin',
        spawn: launch.spawn,
        signal: controller.signal,
      }),
    ).resolves.toBe(false);
    expect(launch.spawn).not.toHaveBeenCalled();
  });

  it('checks ownership again before the queued OS launch', async () => {
    const launch = executor();
    const controller = new AbortController();
    const opened = openAuthorBrowser(SESSION_URL, {
      platform: 'darwin',
      spawn: launch.spawn,
      signal: controller.signal,
    });
    controller.abort();
    await expect(opened).resolves.toBe(false);
    expect(launch.spawn).not.toHaveBeenCalled();
  });

  it('cancels observation without killing the handed-off app and absorbs its late OS error', async () => {
    vi.useFakeTimers();
    const launch = executor();
    const controller = new AbortController();
    const opened = openAuthorBrowser(SESSION_URL, {
      platform: 'linux',
      spawn: launch.spawn,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    await expect(opened).resolves.toBe(false);
    expect(launch.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => launch.child.emit('error', new Error('private-late-OS-error'))).not.toThrow();
    launch.child.emit('close', 0, null);
    expect(launch.child.listenerCount('error')).toBe(0);
    expect(launch.child.listenerCount('exit')).toBe(0);
    expect(launch.child.listenerCount('close')).toBe(0);
  });

  it('accepts a long-lived handler at the observation deadline without killing it', async () => {
    vi.useFakeTimers();
    const launch = executor();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const opened = openAuthorBrowser(SESSION_URL, {
      platform: 'linux',
      spawn: launch.spawn,
      signal: controller.signal,
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(opened).resolves.toBe(true);
    expect(launch.kill).not.toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(launch.child.listenerCount('exit')).toBe(0);
    expect(launch.child.listenerCount('error')).toBe(1);
    expect(launch.child.listenerCount('close')).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    expect(launch.kill).not.toHaveBeenCalled();
    expect(() => launch.child.emit('error', new Error('private-late-OS-error'))).not.toThrow();
    launch.child.emit('close', 1, null);
    expect(launch.child.listenerCount('error')).toBe(0);
    expect(launch.child.listenerCount('close')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline and abort listener when the launcher exits', async () => {
    vi.useFakeTimers();
    const launch = executor();
    const controller = new AbortController();
    const externalErrorListener = vi.fn();
    launch.child.on('error', externalErrorListener);
    const opened = openAuthorBrowser(SESSION_URL, {
      platform: 'linux',
      spawn: launch.spawn,
      signal: controller.signal,
    });
    await Promise.resolve();
    launch.exit(0);
    await expect(opened).resolves.toBe(true);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5000);
    expect(launch.kill).not.toHaveBeenCalled();
    expect(launch.child.listeners('error')).toEqual([externalErrorListener]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['deadline', 'abort'] as const)(
    'leaves an actual owned Node handler alive after observation %s',
    async (end) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      let child: ChildProcess | undefined;
      const ownedSpawn: AuthorBrowserSpawn = (_command, _args, options) => {
        child = spawnProcess(process.execPath, ['-e', 'setInterval(() => {}, 60_000)'], options);
        return child;
      };
      const opened = openAuthorBrowser(SESSION_URL, {
        platform: 'linux',
        spawn: ownedSpawn,
        signal: controller.signal,
      });
      await Promise.resolve();
      if (!child?.pid) throw new Error('Owned test process was not created.');
      const ownedChild = child;
      const closed = new Promise<void>((resolve) => ownedChild.once('close', () => resolve()));
      try {
        await new Promise<void>((resolve, reject) => {
          ownedChild.once('spawn', resolve);
          ownedChild.once('error', reject);
        });
        if (end === 'deadline') await vi.advanceTimersByTimeAsync(5000);
        else controller.abort();
        await expect(opened).resolves.toBe(end === 'deadline');
        expect(ownedChild.killed).toBe(false);
        expect(ownedChild.exitCode).toBe(null);
        expect(ownedChild.signalCode).toBe(null);
        expect(() => process.kill(ownedChild.pid!, 0)).not.toThrow();
        controller.abort();
        expect(ownedChild.killed).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        // Only this test-created process is terminated; production never kills the handler.
        ownedChild.kill('SIGTERM');
        await closed;
      }
    },
  );
});
