import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstat, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { join, relative } from 'node:path';
import { parse, stringify } from 'yaml';

function validate(handle, expectedOrigin) {
  assert.deepEqual(Object.keys(handle).sort(), ['origin', 'url']);
  assert.equal(handle.origin, expectedOrigin);
  assert.match(handle.url, /^http:\/\/127\.0\.0\.1(?::[1-9]\d*)?\/#session=[A-Za-z0-9_-]{43}$/u);
  assert.equal(new URL(handle.url).href, handle.url);
  assert.equal(new URL(handle.url).origin, expectedOrigin);
  return handle;
}

/** Read only a private test bridge; malformed data must never reach error output. */
export async function readAuthorReadyFile(path, expectedOrigin) {
  try {
    const info = await lstat(path);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.size < 1024);
    if (process.platform !== 'win32') assert.equal(info.mode & 0o777, 0o600);
    return validate(JSON.parse(await readFile(path, 'utf8')), expectedOrigin);
  } catch {
    throw new Error('Author readiness unavailable.');
  }
}

/** Own exactly one installed Hexo process group; never forward child diagnostics or URLs. */
export async function withPackedAuthorServer({ site, port, env }, work) {
  class AuthorCancelled extends Error {}
  const controller = new AbortController();
  let ownedWork, unexpectedExit;
  assert.ok(Number.isInteger(port) && port >= 1 && port <= 65535);
  const origin = new URL(`http://127.0.0.1:${port}`).origin;
  const child = spawn(
    process.execPath,
    ['node_modules/hexo/bin/hexo', 'post-map-editor', '--port', String(port)],
    {
      cwd: site,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let resolveReady, rejectReady, resolveCancelled;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const cancelled = new Promise((resolve) => {
    resolveCancelled = resolve;
  });
  let stopping = false,
    timer,
    timeout,
    bridgeCreated = false,
    received = false;
  const kill = (hard = false) => {
    if (!child.pid) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      killer.on('error', () => child.kill('SIGKILL'));
    } else {
      try {
        process.kill(-child.pid, hard ? 'SIGKILL' : 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  };
  const stop = () => {
    if (stopping) return;
    stopping = true;
    kill();
    timer = setTimeout(() => kill(true), 2000);
    timer.unref();
  };
  const cancel = () => {
    controller.abort(new AuthorCancelled('Packed author cancelled.'));
    stop();
    resolveCancelled();
    rejectReady(new AuthorCancelled('Packed author cancelled.'));
  };
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    if (received) return;
    buffer = (buffer + chunk).slice(-4096);
    const match = buffer.match(
      /http:\/\/127\.0\.0\.1(?::[1-9]\d*)?\/#session=[A-Za-z0-9_-]{43}(?=\s|$)/u,
    );
    if (!match) return;
    try {
      const handle = validate({ origin, url: match[0] }, origin);
      received = true;
      buffer = '';
      resolveReady(handle);
    } catch {
      rejectReady(new Error('Packed author readiness invalid.'));
    }
  });
  child.stderr.resume();
  child.on('error', () => rejectReady(new Error('Packed author could not start.')));
  const closed = new Promise((resolve) =>
    child.once('close', () => {
      clearTimeout(timer);
      if (!stopping) {
        unexpectedExit = new Error('Packed author stopped unexpectedly.');
        controller.abort(unexpectedExit);
      }
      if (stopping && process.platform !== 'win32') kill(true);
      rejectReady(new Error('Packed author exited before readiness.'));
      resolve();
    }),
  );
  timeout = setTimeout(() => rejectReady(new Error('Packed author readiness timed out.')), 15000);
  try {
    const handle = await ready;
    clearTimeout(timeout);
    if (env.HPM_AUTHOR_READY_FILE) {
      await writeFile(env.HPM_AUTHOR_READY_FILE, JSON.stringify(handle), {
        mode: 0o600,
        flag: 'wx',
      });
      bridgeCreated = true;
    }
    ownedWork = Promise.resolve().then(() => work(handle, controller.signal));
    await Promise.race([
      ownedWork,
      cancelled,
      closed.then(() => {
        if (unexpectedExit) throw unexpectedExit;
      }),
    ]);
    if (unexpectedExit) throw unexpectedExit;
  } catch (error) {
    if (!(error instanceof AuthorCancelled)) throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort(new AuthorCancelled('Packed author finished.'));
    stop();
    // Promise.race never cancels its losers: drain callback-owned writes/browser cleanup
    // before the outer runner can audit or delete the disposable workspace.
    await ownedWork?.catch(() => {});
    await closed;
    if (bridgeCreated) await rm(env.HPM_AUTHOR_READY_FILE, { force: true });
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

async function inventory(site) {
  const entries = {};
  async function visit(path) {
    const info = await lstat(path).catch(() => undefined);
    if (!info) return;
    assert.ok(!info.isSymbolicLink(), 'Author acceptance cannot follow site symlinks');
    if (info.isDirectory())
      for (const name of (await readdir(path)).sort()) await visit(join(path, name));
    else
      entries[relative(site, path)] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
  }
  for (const path of ['source', 'public', '_config.yml', 'db.json', 'package.json'])
    await visit(join(site, path));
  return entries;
}

/** Exercise the installed candidate without article lifecycle or source substitutions. */
export async function verifyPackedAuthorCommand({ site, env, run }) {
  const cleanEnv = { ...env };
  delete cleanEnv.HPM_AUTHOR_READY_FILE;
  const original = await readFile(join(site, '_config.yml'), 'utf8');
  const baseline = await inventory(site);
  const execute = (args) =>
    run(process.execPath, ['node_modules/hexo/bin/hexo', ...args], site, cleanEnv);
  const help = await execute(['help', 'post-map-editor']);
  assert.equal(help.code, 0, 'Installed author help failed');
  assert.ok(help.stdout.includes('post-map-editor') && help.stdout.includes('--port'));
  assert.deepEqual(await inventory(site), baseline, 'Author help changed site bytes');
  const owner = createServer();
  await new Promise((ready, reject) => {
    owner.once('error', reject);
    owner.listen(0, '127.0.0.1', ready);
  });
  const port = owner.address().port;
  try {
    const conflict = await execute(['post-map-editor', '--port', String(port)]);
    assert.notEqual(conflict.code, 0, 'Installed author command must reject an occupied port');
    assert.ok(owner.listening, 'Port conflict stopped the owner');
  } finally {
    await new Promise((done) => owner.close(done));
  }
  try {
    for (const settings of [
      undefined,
      { enabled: false, amap: {} },
      {
        enabled: false,
        amap: { key: 'author-fixture-key', security: { security_js_code: 'author-fixture-code' } },
      },
    ]) {
      const config = parse(original);
      if (settings === undefined) delete config.post_map;
      else config.post_map = settings;
      await writeFile(join(site, '_config.yml'), stringify(config));
      const before = await inventory(site);
      await withPackedAuthorServer({ site, port, env: cleanEnv }, async ({ origin, url }) => {
        const headers = { 'X-HPM-Editor-Session': new URL(url).hash.slice('#session='.length) };
        const response = await fetch(`${origin}/api/bootstrap`, { headers });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).mode, settings?.amap?.key ? 'map' : 'manual');
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal((await fetch(`${origin}/api/bootstrap`)).status, 403);
        assert.equal(
          (
            await fetch(`${origin}/api/bootstrap`, {
              headers: { ...headers, Origin: 'https://attacker.invalid' },
            })
          ).status,
          403,
        );
        const html = await (await fetch(origin)).text();
        assert.ok(!html.includes('author-fixture-key') && !html.includes('author-fixture-code'));
        assert.equal((await fetch(`${origin}/source/_posts/plain.md`)).status, 404);
      });
      assert.deepEqual(
        await inventory(site),
        before,
        'Author session changed source/public/config/db bytes',
      );
    }
  } finally {
    await writeFile(join(site, '_config.yml'), original);
  }
  assert.deepEqual(await inventory(site), baseline, 'Author acceptance changed site bytes');
  const assets = (await readdir(join(site, 'public/hexo-post-map/assets'))).sort();
  assert.deepEqual(assets, [
    'overview-map.js',
    'placeholder.svg',
    'post-map.js',
    'runtime.js',
    'style.css',
  ]);
  assert.ok(
    Object.keys(baseline)
      .filter((path) => path.startsWith('public/'))
      .every((path) => !/(?:^|\/)(?:author|editor|bootstrap)(?:[./]|$)/u.test(path)),
    'Author content reached generated public output',
  );
}
