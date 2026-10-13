import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const modulePath = resolve('test/integration/author-server.mjs');
const token = 'a'.repeat(43);
async function supervisor() {
  expect(
    await stat(modulePath).then(
      () => true,
      () => false,
    ),
    'packed author supervisor is connected',
  ).toBe(true);
  return import(modulePath);
}
async function site(code: string, work: (site: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'hpm-author-unit-'));
  try {
    await mkdir(join(directory, 'node_modules/hexo/bin'), { recursive: true });
    await writeFile(join(directory, 'node_modules/hexo/bin/hexo'), code);
    await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const child = `const http = require('node:http');
const port = Number(process.argv.at(-1));
const server = http.createServer((req, res) => {
  if (req.url === '/exit') res.once('finish', () => process.exit(0));
  res.end('alive');
});
server.on('error', () => { console.error('secret diagnostic #session=${token}'); process.exit(1); });
server.listen(port, '127.0.0.1', () => console.log('INFO http://127.0.0.1:' + port + '/#session=${token}'));
process.on('SIGTERM', () => server.close());`;
async function freePort() {
  const server = createServer();
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}
describe('packed author supervisor', () => {
  it('accepts canonical HTTP port 80 readiness but rejects explicit default-port aliases', async () => {
    const { readAuthorReadyFile } = await supervisor();
    await site('', async (directory) => {
      const path = join(directory, 'ready.json');
      const origin = 'http://127.0.0.1';
      const handle = { origin, url: `${origin}/#session=${token}` };
      await writeFile(path, JSON.stringify(handle), { mode: 0o600 });
      expect(await readAuthorReadyFile(path, origin)).toEqual(handle);
      await writeFile(
        path,
        JSON.stringify({ origin, url: `http://127.0.0.1:80/#session=${token}` }),
      );
      await expect(readAuthorReadyFile(path, origin)).rejects.toThrow(
        'Author readiness unavailable.',
      );
    });
  });
  it.each(['cancel', 'exit'])(
    'drains owned async writes and resource finalization before returning after %s during work',
    async (cause) => {
      const { withPackedAuthorServer } = await supervisor();
      const port = await freePort();
      await site(child, async (site) => {
        const bridge = join(site, 'ready.json');
        const written = join(site, 'work.txt');
        const actions: string[] = [];
        let release: () => void = () => {};
        const paused = new Promise<void>((resolve) => {
          release = resolve;
        });
        let notifyStarted: () => void = () => {};
        const started = new Promise<void>((resolve) => {
          notifyStarted = resolve;
        });
        const pending = withPackedAuthorServer(
          { site, port, env: { ...process.env, HPM_AUTHOR_READY_FILE: bridge } },
          async (_handle: unknown, signal?: AbortSignal) => {
            notifyStarted();
            try {
              await paused;
              if (!signal?.aborted) {
                await writeFile(written, 'late write');
                actions.push('write');
              }
            } finally {
              // Model an asynchronous browser/resource close owned by the callback.
              await new Promise((resolve) => setTimeout(resolve, 30));
              actions.push('resource closed');
            }
          },
        );
        // Observe rejection immediately so an unexpected exit is not unhandled.
        const outcome = pending.then(
          () => undefined,
          (error: Error) => error.message,
        );
        await started;
        if (cause === 'cancel') process.emit('SIGTERM');
        else {
          // Ask this test's server process to exit, not a global/unknown owner.
          await fetch(`http://127.0.0.1:${port}/exit`);
        }
        let returned = false;
        void outcome.then(() => {
          returned = true;
        });
        try {
          await new Promise((resolve) => setTimeout(resolve, 60));
          expect(returned, 'wrapper must wait for its paused callback finalization').toBe(false);
        } finally {
          release();
          await outcome;
        }
        expect(await outcome).toBe(
          cause === 'exit' ? 'Packed author stopped unexpectedly.' : undefined,
        );
        expect(actions).toEqual(['resource closed']);
        expect(await stat(written).catch(() => undefined)).toBeUndefined();
        const completed = [...actions];
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(actions).toEqual(completed);
        expect(await stat(bridge).catch(() => undefined)).toBeUndefined();
        await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
      });
    },
  );
  it.skipIf(process.platform === 'win32')(
    'startup cancellation returns quietly, stops its child and creates no bridge',
    async () => {
      await supervisor();
      const port = await freePort();
      await site(`setTimeout(() => { ${child} }, 1000);`, async (site) => {
        const ready = join(site, 'ready.json');
        const processChild = spawn(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `import { withPackedAuthorServer } from ${JSON.stringify(modulePath)}; const pending = withPackedAuthorServer({ site: ${JSON.stringify(site)}, port: ${port}, env: {...process.env, HPM_AUTHOR_READY_FILE: ${JSON.stringify(ready)}} }, (_handle, signal) => new Promise(resolve => signal.aborted ? resolve() : signal.addEventListener('abort', resolve, {once:true}))); console.log('supervisor pending'); await pending; console.log('clean cancellation');`,
          ],
          { stdio: 'pipe' },
        );
        let output = '';
        processChild.stdout.on('data', (chunk) => {
          output += chunk;
        });
        processChild.stderr.on('data', (chunk) => {
          output += chunk;
        });
        const closed = new Promise((resolve) =>
          processChild.once('close', (code, signal) => resolve({ code, signal })),
        );
        try {
          for (let attempt = 0; attempt < 100 && !output.includes('supervisor pending'); attempt++)
            await new Promise((resolve) => setTimeout(resolve, 20));
          expect(output).toContain('supervisor pending');
          processChild.kill('SIGTERM');
          expect(await closed).toEqual({ code: 0, signal: null });
          expect(output).toContain('clean cancellation');
          expect(output).not.toContain('Error:');
          expect(output).not.toContain(token);
          expect(
            await stat(ready).then(
              () => true,
              () => false,
            ),
          ).toBe(false);
          await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
        } finally {
          if (processChild.exitCode === null) processChild.kill('SIGKILL');
          await closed;
        }
      });
    },
  );
  it.skipIf(process.platform === 'win32')(
    'SIGTERM stops only its own group and removes the private ready bridge before returning',
    async () => {
      await supervisor();
      const port = await freePort();
      await site(child, async (site) => {
        const ready = join(site, 'ready.json');
        const processChild = spawn(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `import { withPackedAuthorServer } from ${JSON.stringify(modulePath)}; await withPackedAuthorServer({site: ${JSON.stringify(site)}, port: ${port}, env: {...process.env, HPM_AUTHOR_READY_FILE: ${JSON.stringify(ready)}}}, (_handle, signal) => new Promise(resolve => signal.aborted ? resolve() : signal.addEventListener('abort', resolve, {once:true})));`,
          ],
          { stdio: 'pipe' },
        );
        let output = '';
        processChild.stdout.on('data', (chunk) => {
          output += chunk;
        });
        processChild.stderr.on('data', (chunk) => {
          output += chunk;
        });
        const closed = new Promise((resolve) => processChild.once('close', resolve));
        try {
          for (let attempt = 0; attempt < 100 && !(await stat(ready).catch(() => false)); attempt++)
            await new Promise((resolve) => setTimeout(resolve, 20));
          expect(
            await stat(ready).then(
              () => true,
              () => false,
            ),
          ).toBe(true);
          processChild.kill('SIGTERM');
          await closed;
          expect(
            await stat(ready).then(
              () => true,
              () => false,
            ),
          ).toBe(false);
          await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
          expect(output).not.toContain(token);
        } finally {
          if (processChild.exitCode === null) processChild.kill('SIGKILL');
          await closed;
        }
      });
    },
  );
  it('receives a fragment URL privately, creates a strict 0600 bridge, and removes its listener and bridge', async () => {
    const { withPackedAuthorServer, readAuthorReadyFile } = await supervisor();
    const port = await freePort();
    await site(child, async (site) => {
      const ready = join(site, 'ready.json');
      await withPackedAuthorServer(
        { site, port, env: { ...process.env, HPM_AUTHOR_READY_FILE: ready } },
        async (handle: { origin: string; url: string }) => {
          expect(handle).toEqual({
            origin: `http://127.0.0.1:${port}`,
            url: `http://127.0.0.1:${port}/#session=${token}`,
          });
          expect((await stat(ready)).mode & 0o777).toBe(0o600);
          expect(await readAuthorReadyFile(ready, handle.origin)).toEqual(handle);
          expect(Object.keys(JSON.parse(await readFile(ready, 'utf8')))).toEqual(['origin', 'url']);
          expect(await (await fetch(handle.origin)).text()).toBe('alive');
        },
      );
      expect(
        await stat(ready).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
    });
  });
  it('cleans up on callback exceptions and never includes session data in child errors', async () => {
    const { withPackedAuthorServer } = await supervisor();
    const port = await freePort();
    await site(child, async (site) => {
      await expect(
        withPackedAuthorServer({ site, port, env: process.env }, async () => {
          throw new Error('callback failed');
        }),
      ).rejects.toThrow('callback failed');
      await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
    });
    await site(`console.log('bad #session=${token}'); process.exit(1)`, async (site) => {
      await expect(
        withPackedAuthorServer({ site, port, env: process.env }, async () => {}),
      ).rejects.toThrow(/^Packed author exited before readiness\.$/u);
    });
  });
  it('fails on port conflict without stopping the existing owner and supports a fresh restart', async () => {
    const { withPackedAuthorServer } = await supervisor();
    const port = await freePort();
    await site(child, async (site) => {
      await withPackedAuthorServer({ site, port, env: process.env }, async () => {
        await expect(
          withPackedAuthorServer({ site, port, env: process.env }, async () => {}),
        ).rejects.toThrow('Packed author exited before readiness.');
        expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe('alive');
      });
      await withPackedAuthorServer({ site, port, env: process.env }, async () => {});
    });
  });
  it.each(['missing', 'malformed', 'extra', 'origin', 'token', 'permissions'])(
    'rejects a %s ready bridge',
    async (kind) => {
      const { readAuthorReadyFile } = await supervisor();
      await site('', async (site) => {
        const path = join(site, 'bridge.json');
        const origin = 'http://127.0.0.1:4180';
        if (kind !== 'missing')
          await writeFile(
            path,
            kind === 'malformed'
              ? '{'
              : JSON.stringify({
                  origin: kind === 'origin' ? 'http://localhost:4180' : origin,
                  url: `${origin}/#session=${kind === 'token' ? 'short' : token}`,
                  ...(kind === 'extra' ? { extra: true } : {}),
                }),
            { mode: kind === 'permissions' ? 0o644 : 0o600 },
          );
        await expect(readAuthorReadyFile(path, origin)).rejects.toThrow(
          'Author readiness unavailable.',
        );
      });
    },
  );
});
