import { ChildProcess } from 'node:child_process';
import Hexo from 'hexo';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPlugin } from '../../src/hexo/register';
import { parseAuthorPort, registerAuthorCommand } from '../../src/hexo/author-command';
import * as authorEntry from '../../src/author/entry';
import type { AuthorServerHandle } from '../../src/author/server';
import type { AuthorBrowserSpawn } from '../../src/author/open-browser';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fixture() {
  const hexo = new Hexo('/tmp/hpm-author-command');
  const lifecycle = ['load', '_generate', 'watch', 'call'] as const;
  const operations = lifecycle.map((name) => vi.spyOn(hexo, name));
  const info = vi.spyOn(hexo.log, 'info').mockImplementation(() => {});
  const warn = vi.spyOn(hexo.log, 'warn').mockImplementation(() => {});
  return { hexo, operations, info, warn };
}

function session() {
  let resolve!: () => void;
  const closed = new Promise<void>((done) => (resolve = done));
  const close = vi.fn(async () => resolve());
  const handle: AuthorServerHandle = {
    origin: 'http://127.0.0.1:4001',
    url: `http://127.0.0.1:4001/#session=${'x'.repeat(43)}`,
    closed,
    close,
  };
  return { handle, close, resolve };
}

function browserExecutor() {
  const child = new ChildProcess();
  const kill = vi.spyOn(child, 'kill').mockReturnValue(true);
  const spawn = vi.fn<AuthorBrowserSpawn>(() => child);
  const exit = (code: number | null) => {
    child.emit('exit', code, null);
    child.emit('close', code, null);
  };
  return { child, kill, spawn, exit };
}

describe('author command registration', () => {
  it.each([undefined, { enabled: false }, { enabled: true, provider: 'unknown' }])(
    'registers without starting author code for missing, disabled or invalid publication config %j',
    (raw) => {
      const { hexo, operations } = fixture();
      hexo.config.post_map = raw;
      const signals = process.listeners('SIGTERM');
      registerPlugin(hexo);
      expect(hexo.extend.console.get('post-map-editor')).toBeDefined();
      for (const operation of operations) expect(operation).not.toHaveBeenCalled();
      expect(process.listeners('SIGTERM')).toEqual(signals);
      expect(hexo.extend.filter.list().before_exit).toBeUndefined();
    },
  );

  it('retains the normal before_generate configuration failure', async () => {
    const { hexo } = fixture();
    hexo.config.post_map = { enabled: true, provider: 'unknown' };
    registerPlugin(hexo);
    expect(hexo.extend.console.get('post-map-editor')).toBeDefined();
    await expect(hexo.extend.filter.exec('before_generate', undefined)).rejects.toMatchObject({
      name: 'ConfigValidationError',
    });
  });

  it('keeps the lazy loader idle through normal reader filters and generation', async () => {
    const { hexo } = fixture();
    const load = vi.fn();
    registerAuthorCommand(hexo, load);
    await hexo.extend.filter.exec('before_generate', undefined);
    await hexo.extend.filter.exec('after_generate', undefined);
    await hexo.extend.filter.exec('before_exit', undefined);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('author port', () => {
  it.each([
    [{}, 4001],
    [{ port: 1 }, 1],
    [{ port: 65535 }, 65535],
    [{ port: '4002' }, 4002],
    [{ port: '00080' }, 80],
  ])('parses only an explicit decimal integer or the default %j', (args, port) => {
    expect(parseAuthorPort(args)).toBe(port);
  });

  it.each([
    0,
    65536,
    -1,
    1.1,
    NaN,
    Infinity,
    '',
    ' ',
    '4001.0',
    '4e3',
    '0xFA1',
    '+4001',
    '4001\n',
    ' 4001',
    '0',
    '65536',
    ['4001', '4002'],
    ['4001'],
    true,
    null,
    undefined,
  ])('rejects an invalid or repeated explicit port %j', (port) => {
    expect(() => parseAuthorPort({ port })).toThrow();
  });

  it.each(['127.0.0.1', '', undefined, false])('rejects --host regardless of value %j', (host) => {
    expect(() => parseAuthorPort({ host })).toThrow();
  });
});

describe('author command lifecycle', () => {
  it('starts only on demand, logs only this session URL and awaits close without site operations', async () => {
    const { hexo, operations, info } = fixture();
    hexo.config.post_map = { enabled: false, amap: { key: 'private-key' } };
    const active = session();
    const startAuthorSession = vi.fn(async () => active.handle);
    const load = vi.fn(async () => ({ startAuthorSession }));
    registerAuthorCommand(hexo, load);
    expect(load).not.toHaveBeenCalled();
    const command = hexo.extend.console.get('post-map-editor');
    expect(command.options?.options).toEqual([
      { name: '--port', desc: expect.any(String) },
      { name: '--open', desc: expect.any(String) },
    ]);
    let ended = false;
    const running = command.call(hexo, { _: [], port: '4001' }).then(() => (ended = true));
    await vi.waitFor(() => expect(info).toHaveBeenCalled());
    expect(startAuthorSession).toHaveBeenCalledExactlyOnceWith({
      port: 4001,
      rawConfig: hexo.config.post_map,
      env: process.env,
    });
    expect(info.mock.calls).toEqual([[active.handle.url], [expect.stringContaining('Ctrl+C')]]);
    expect(ended).toBe(false);
    for (const operation of operations) expect(operation).not.toHaveBeenCalled();
    await active.handle.close();
    await running;
    expect(ended).toBe(true);
    expect(hexo.extend.filter.list().before_exit).toEqual([]);
  });

  it.each(['before_exit', 'SIGTERM', 'SIGINT'] as const)(
    'closes through %s and removes only its own listeners',
    async (exit) => {
      const { hexo, info } = fixture();
      const active = session();
      const existingExit = vi.fn();
      hexo.extend.filter.register('before_exit', existingExit);
      const hostTerm = vi.fn();
      const hostInt = vi.fn(() => {
        void hexo.extend.filter.exec('before_exit', undefined);
      });
      process.on('SIGTERM', hostTerm);
      process.on('SIGINT', hostInt);
      const originalTerm = process.listeners('SIGTERM');
      const originalInt = process.listeners('SIGINT');
      registerAuthorCommand(hexo, async () => ({ startAuthorSession: async () => active.handle }));
      const running = hexo.extend.console.get('post-map-editor').call(hexo, { _: [] });
      try {
        await vi.waitFor(() => expect(info).toHaveBeenCalled());
        expect(process.listeners('SIGINT')).toEqual(originalInt);
        if (exit === 'before_exit') await hexo.extend.filter.exec('before_exit', undefined);
        else process.emit(exit);
        await running;
        expect(active.close).toHaveBeenCalledOnce();
        expect(process.listeners('SIGTERM')).toEqual(originalTerm);
        expect(process.listeners('SIGINT')).toEqual(originalInt);
        await hexo.extend.filter.exec('before_exit', undefined);
        expect(existingExit).toHaveBeenCalled();
        expect(active.close).toHaveBeenCalledOnce();
      } finally {
        await active.handle.close();
        process.removeListener('SIGTERM', hostTerm);
        process.removeListener('SIGINT', hostInt);
      }
    },
  );

  it('fails occupied ports once without fallback, process killing, secrets or leaked handlers', async () => {
    const { hexo, operations, info } = fixture();
    const term = process.listeners('SIGTERM');
    const int = process.listeners('SIGINT');
    const kill = vi.spyOn(process, 'kill');
    const startAuthorSession = vi.fn(async () => {
      throw Object.assign(new Error('private-key'), { code: 'HPM_AUTHOR_PORT_IN_USE' });
    });
    const load = vi.fn(async () => ({ startAuthorSession }));
    registerAuthorCommand(hexo, load);
    const running = hexo.extend.console.get('post-map-editor').call(hexo, { _: [], port: '4567' });
    await expect(running).rejects.toThrow('4567');
    await expect(running).rejects.toThrow('another port');
    await expect(running).rejects.not.toThrow('private-key');
    expect(startAuthorSession).toHaveBeenCalledOnce();
    expect(startAuthorSession.mock.calls[0]).toEqual([
      { port: 4567, rawConfig: undefined, env: process.env },
    ]);
    expect(kill).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    for (const operation of operations) expect(operation).not.toHaveBeenCalled();
    expect(process.listeners('SIGTERM')).toEqual(term);
    expect(process.listeners('SIGINT')).toEqual(int);
    expect(hexo.extend.filter.list().before_exit ?? []).toEqual([]);
  });

  it('rejects invalid command arguments before loading author code', async () => {
    const { hexo } = fixture();
    const load = vi.fn();
    registerAuthorCommand(hexo, load);
    await expect(
      hexo.extend.console.get('post-map-editor').call(hexo, { _: [], host: '0.0.0.0' }),
    ).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
  });

  it.each(
    [
      'true',
      'false',
      '',
      'http://example.test',
      1,
      0,
      null,
      undefined,
      [true, true],
      ['true'],
      {},
    ].map((open) => [open]),
  )('rejects an invalid explicit --open value before loading author code %j', async (open) => {
    const { hexo } = fixture();
    const load = vi.fn();
    registerAuthorCommand(hexo, load);
    const command = hexo.extend.console.get('post-map-editor');
    // Deliberately cross the typed CLI boundary with malformed runtime input.
    const args = { _: [], open } as unknown as Parameters<typeof command>[0];
    await expect(command.call(hexo, args)).rejects.toThrow('--open');
    expect(load).not.toHaveBeenCalled();
  });

  it.each(
    [
      ['--open', '--open'],
      ['--open=true'],
      ['--open=false'],
      ['--open', 'true'],
      ['--open', 'false'],
      ['--open', 'https://example.test'],
      ['--open', '--no-open'],
      ['--no-open', '--no-open'],
      ['--no-open=true'],
    ].map((raw) => [raw]),
  )(
    'rejects CLI-coerced or repeated --open arguments before loading author code %j',
    async (raw) => {
      const { hexo } = fixture();
      const load = vi.fn();
      registerAuthorCommand(hexo, load);
      const args = { _: [], open: true };
      hexo.env.cmd = 'post-map-editor';
      hexo.env.args = args;
      const originalArgv = process.argv;
      process.argv = ['node', 'hexo', 'post-map-editor', ...raw];
      try {
        await expect(hexo.extend.console.get('post-map-editor').call(hexo, args)).rejects.toThrow(
          '--open',
        );
        expect(load).not.toHaveBeenCalled();
      } finally {
        process.argv = originalArgv;
      }
    },
  );
});

describe('author command browser launch', () => {
  it.each([undefined, false])('keeps opening opt-in for %j', async (open) => {
    const { hexo, info, warn } = fixture();
    const active = session();
    const launch = browserExecutor();
    registerAuthorCommand(hexo, async () => ({ startAuthorSession: async () => active.handle }), {
      platform: 'darwin',
      spawn: launch.spawn,
    });
    const command = hexo.extend.console.get('post-map-editor');
    const args: Parameters<typeof command>[0] = { _: [] };
    if (open !== undefined) args.open = open;
    const running = command.call(hexo, args);
    try {
      await vi.waitFor(() => expect(info).toHaveBeenCalled());
      expect(launch.spawn).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      await active.handle.close();
      await running;
    }
  });

  it('opens only the full returned URL and remains active after the OS launcher exits', async () => {
    const { hexo, info, warn, operations } = fixture();
    const active = session();
    active.handle.origin = 'http://127.0.0.1:4568';
    active.handle.url =
      'http://127.0.0.1:4568/#session=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const launch = browserExecutor();
    const load = vi.fn(async () => ({
      ...authorEntry,
      startAuthorSession: async () => active.handle,
    }));
    registerAuthorCommand(hexo, load, { platform: 'darwin', spawn: launch.spawn });
    expect(load).not.toHaveBeenCalled();
    let ended = false;
    const running = hexo.extend.console
      .get('post-map-editor')
      .call(hexo, { _: [], port: '4567', open: true })
      .then(() => (ended = true));
    try {
      await vi.waitFor(() => expect(info).toHaveBeenCalled());
      expect(load).toHaveBeenCalledOnce();
      expect(launch.spawn).toHaveBeenCalledExactlyOnceWith(
        '/usr/bin/open',
        ['http://127.0.0.1:4568/#session=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
        { shell: false, stdio: 'ignore', detached: true, windowsHide: true },
      );
      launch.exit(0);
      await Promise.resolve();
      expect(ended).toBe(false);
      expect(active.close).not.toHaveBeenCalled();
      expect(info.mock.calls).toEqual([[active.handle.url], [expect.stringContaining('Ctrl+C')]]);
      expect(warn).not.toHaveBeenCalled();
      for (const operation of operations) expect(operation).not.toHaveBeenCalled();
    } finally {
      await active.handle.close();
      await running;
    }
    expect(ended).toBe(true);
  });

  it.each(['throw', 'error', 'exit'] as const)(
    'keeps the session alive and reports only a safe message after OS %s failure',
    async (failure) => {
      const { hexo, info, warn } = fixture();
      const active = session();
      const launch = browserExecutor();
      if (failure === 'throw') {
        launch.spawn.mockImplementation(() => {
          throw new Error('private-OS-error');
        });
      }
      registerAuthorCommand(
        hexo,
        async () => ({ ...authorEntry, startAuthorSession: async () => active.handle }),
        { platform: 'linux', spawn: launch.spawn },
      );
      let ended = false;
      const running = hexo.extend.console
        .get('post-map-editor')
        .call(hexo, { _: [], open: true })
        .then(() => (ended = true));
      try {
        await vi.waitFor(() => expect(info).toHaveBeenCalled());
        if (failure === 'error') launch.child.emit('error', new Error('private-OS-error'));
        if (failure !== 'throw') launch.exit(1);
        await vi.waitFor(() => expect(warn).toHaveBeenCalled());
        expect(warn.mock.calls).toEqual([
          [
            '[hexo-post-map] Unable to open the browser automatically; open the URL above manually.',
          ],
        ]);
        expect(info.mock.calls).toEqual([[active.handle.url], [expect.stringContaining('Ctrl+C')]]);
        expect(ended).toBe(false);
        expect(active.close).not.toHaveBeenCalled();
      } finally {
        await active.handle.close();
        await running;
      }
    },
  );

  it('passes the returned URL through the real helper validation', async () => {
    const { hexo, warn } = fixture();
    const active = session();
    active.handle.url =
      'http://127.0.0.1:4001/?outside=1#session=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const launch = browserExecutor();
    registerAuthorCommand(
      hexo,
      async () => ({ ...authorEntry, startAuthorSession: async () => active.handle }),
      { platform: 'darwin', spawn: launch.spawn },
    );
    const running = hexo.extend.console.get('post-map-editor').call(hexo, { _: [], open: true });
    try {
      await vi.waitFor(() => expect(warn).toHaveBeenCalled());
      expect(launch.spawn).not.toHaveBeenCalled();
      expect(active.close).not.toHaveBeenCalled();
    } finally {
      await active.handle.close();
      await running;
    }
  });

  it.each(['before_exit', 'SIGTERM', 'SIGINT'] as const)(
    'cancels observation through %s without killing the application or leaking listeners',
    async (exit) => {
      const { hexo, info, warn } = fixture();
      const active = session();
      const launch = browserExecutor();
      const hostTerm = vi.fn();
      const hostInt = vi.fn(() => {
        void hexo.extend.filter.exec('before_exit', undefined);
      });
      process.on('SIGTERM', hostTerm);
      process.on('SIGINT', hostInt);
      const originalTerm = process.listeners('SIGTERM');
      const originalInt = process.listeners('SIGINT');
      registerAuthorCommand(
        hexo,
        async () => ({ ...authorEntry, startAuthorSession: async () => active.handle }),
        { platform: 'linux', spawn: launch.spawn },
      );
      const running = hexo.extend.console.get('post-map-editor').call(hexo, { _: [], open: true });
      try {
        await vi.waitFor(() => expect(info).toHaveBeenCalled());
        expect(launch.spawn).toHaveBeenCalledOnce();
        if (exit === 'before_exit') await hexo.extend.filter.exec('before_exit', undefined);
        else process.emit(exit);
        await running;
        expect(active.close).toHaveBeenCalledOnce();
        expect(launch.kill).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        expect(process.listeners('SIGTERM')).toEqual(originalTerm);
        expect(process.listeners('SIGINT')).toEqual(originalInt);
        expect(hexo.extend.filter.list().before_exit ?? []).toEqual([]);
        expect(() => launch.child.emit('error', new Error('private-late-OS-error'))).not.toThrow();
        launch.child.emit('close', 0, null);
        await Promise.resolve();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        await active.handle.close();
        process.removeListener('SIGTERM', hostTerm);
        process.removeListener('SIGINT', hostInt);
      }
    },
  );

  it('does not open a session that closed before startup returned', async () => {
    const { hexo, warn } = fixture();
    const active = session();
    active.resolve();
    const launch = browserExecutor();
    registerAuthorCommand(
      hexo,
      async () => ({ ...authorEntry, startAuthorSession: async () => active.handle }),
      { platform: 'darwin', spawn: launch.spawn },
    );
    await hexo.extend.console.get('post-map-editor').call(hexo, { _: [], open: true });
    expect(launch.spawn).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not open after session.closed resolves while the URL is logged', async () => {
    const { hexo, info, warn } = fixture();
    const active = session();
    info.mockImplementationOnce(() => active.resolve());
    const launch = browserExecutor();
    registerAuthorCommand(
      hexo,
      async () => ({ ...authorEntry, startAuthorSession: async () => active.handle }),
      { platform: 'darwin', spawn: launch.spawn },
    );
    await hexo.extend.console.get('post-map-editor').call(hexo, { _: [], open: true });
    expect(launch.spawn).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps a long-lived handed-off application without a timeout or late-error warning', async () => {
    vi.useFakeTimers();
    const { hexo, warn } = fixture();
    const active = session();
    const launch = browserExecutor();
    registerAuthorCommand(
      hexo,
      async () => ({ ...authorEntry, startAuthorSession: async () => active.handle }),
      { platform: 'linux', spawn: launch.spawn },
    );
    let ended = false;
    const running = hexo.extend.console
      .get('post-map-editor')
      .call(hexo, { _: [], open: true })
      .then(() => (ended = true));
    try {
      await vi.advanceTimersByTimeAsync(5000);
      expect(launch.spawn).toHaveBeenCalledOnce();
      expect(launch.kill).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(ended).toBe(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(launch.kill).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(() => launch.child.emit('error', new Error('private-late-OS-error'))).not.toThrow();
      launch.exit(1);
      await Promise.resolve();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      await active.handle.close();
      await running;
    }
    expect(ended).toBe(true);
  });

  it('keeps an older loaded module usable when its optional browser launcher is absent', async () => {
    const { hexo, info, warn } = fixture();
    const active = session();
    const launch = browserExecutor();
    const load = vi.fn(async () => ({ startAuthorSession: async () => active.handle }));
    registerAuthorCommand(hexo, load, { platform: 'darwin', spawn: launch.spawn });
    let ended = false;
    const running = hexo.extend.console
      .get('post-map-editor')
      .call(hexo, { _: [], open: true })
      .then(() => (ended = true));
    try {
      await vi.waitFor(() => expect(warn).toHaveBeenCalled());
      expect(load).toHaveBeenCalledOnce();
      expect(launch.spawn).not.toHaveBeenCalled();
      expect(warn.mock.calls).toEqual([
        ['[hexo-post-map] Unable to open the browser automatically; open the URL above manually.'],
      ]);
      expect(info.mock.calls).toEqual([[active.handle.url], [expect.stringContaining('Ctrl+C')]]);
      expect(active.close).not.toHaveBeenCalled();
      expect(ended).toBe(false);
    } finally {
      await active.handle.close();
      await running;
    }
    expect(ended).toBe(true);
  });
});
