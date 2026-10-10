import Hexo from 'hexo';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPlugin } from '../../src/hexo/register';
import { parseAuthorPort, registerAuthorCommand } from '../../src/hexo/author-command';
import type { AuthorServerHandle } from '../../src/author/server';

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const hexo = new Hexo('/tmp/hpm-author-command');
  const lifecycle = ['load', '_generate', 'watch', 'call'] as const;
  const operations = lifecycle.map((name) => vi.spyOn(hexo, name));
  const info = vi.spyOn(hexo.log, 'info').mockImplementation(() => {});
  return { hexo, operations, info };
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
    expect(command.options?.options).toEqual([{ name: '--port', desc: expect.any(String) }]);
    let ended = false;
    const running = command.call(hexo, { _: [], port: '4001' }).then(() => (ended = true));
    await vi.waitFor(() => expect(info).toHaveBeenCalled());
    expect(startAuthorSession).toHaveBeenCalledExactlyOnceWith({
      port: 4001,
      rawConfig: hexo.config.post_map,
      env: process.env,
    });
    expect(info.mock.calls).toEqual([[active.handle.url]]);
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
      throw Object.assign(new Error('private-key'), { code: 'EADDRINUSE' });
    });
    const load = vi.fn(async () => ({ startAuthorSession }));
    registerAuthorCommand(hexo, load);
    const running = hexo.extend.console.get('post-map-editor').call(hexo, { _: [], port: '4567' });
    await expect(running).rejects.toThrow('4567');
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
});
