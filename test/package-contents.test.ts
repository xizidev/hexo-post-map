import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import Hexo from 'hexo';
import { expect, it, vi } from 'vitest';
import type { AuthorSessionModule } from '../src/hexo/author-command';
import { normalizeNpmPackJson } from '../scripts/npm-pack-json.mjs';

it('publishes only compiled assets, readmes, license, and package metadata', () => {
  const packages = normalizeNpmPackJson(
    JSON.parse(
      execFileSync('npm', ['pack', '--json', '--dry-run', '--ignore-scripts'], {
        encoding: 'utf8',
      }),
    ),
  );
  expect(packages).toHaveLength(1);
  const files = packages.flatMap((entry) => entry.files.map((file) => file.path));
  const allowed = new Set(['README.md', 'README.zh-CN.md', 'LICENSE', 'package.json']);
  expect(files.length).toBeGreaterThanOrEqual(4);
  expect(files.filter((file) => !file.startsWith('dist/') && !allowed.has(file))).toEqual([]);
  expect(files.filter((file) => file.endsWith('.map'))).toEqual([]);
  expect(files).toEqual(expect.arrayContaining([...allowed]));
  expect(files).toEqual(
    expect.arrayContaining([
      'dist/index.cjs',
      'dist/author/server.cjs',
      'dist/author/editor.html',
      'dist/author/editor.js',
      'dist/author/editor.css',
    ]),
  );
}, 15_000);

it('ships exactly the five public reader assets and keeps author assets separate and credential-free', async () => {
  expect((await readdir('dist/assets')).sort()).toEqual([
    'overview-map.js',
    'placeholder.svg',
    'post-map.js',
    'runtime.js',
    'style.css',
  ]);
  expect((await readdir('dist/author')).sort()).toEqual([
    'editor.css',
    'editor.html',
    'editor.js',
    'server.cjs',
  ]);
  for (const file of ['editor.html', 'editor.js', 'editor.css']) {
    const content = await readFile(`dist/author/${file}`, 'utf8');
    expect(content).not.toContain('private-test-key');
    expect(content).not.toContain('private-test-security-code');
    expect(content).not.toContain('sourceMappingURL');
  }
});

it('requires the compiled reader plugin and generates only public routes without loading the author server', async () => {
  const hexo = new Hexo('/tmp/hpm-packaged-lazy-author');
  hexo.config.post_map = {
    enabled: true,
    overview: { enabled: false },
    amap: {
      key: 'private-test-key',
      security: { security_js_code: 'private-test-security-code' },
    },
  };
  const required: string[] = [];
  const realRequire = createRequire(resolve('dist/index.cjs'));
  runInNewContext(await readFile('dist/index.cjs', 'utf8'), {
    hexo,
    __dirname: resolve('dist'),
    process,
    Buffer,
    console,
    require(id: string) {
      required.push(id);
      if (id.includes('author')) throw new Error('Author bundle loaded during ordinary generation');
      return realRequire(id);
    },
  });
  expect(hexo.extend.console.get('post-map-editor')).toBeDefined();
  const generator = hexo.extend.generator.get('post-map');
  const routes = await generator.call(hexo, { posts: { toArray: () => [] } } as never);
  expect(routes.map((route: { path: string }) => route.path).sort()).toEqual([
    'hexo-post-map/assets/overview-map.js',
    'hexo-post-map/assets/placeholder.svg',
    'hexo-post-map/assets/post-map.js',
    'hexo-post-map/assets/runtime.js',
    'hexo-post-map/assets/style.css',
  ]);
  expect(required.filter((id) => id.includes('author'))).toEqual([]);
});

it('uses the external sibling require only when the compiled author command runs', async () => {
  const hexo = new Hexo('/tmp/hpm-packaged-author');
  hexo.config.post_map = { enabled: false };
  let finish!: () => void;
  const closed = new Promise<void>((done) => (finish = done));
  const startAuthorSession = vi.fn(async () => ({
    origin: 'http://127.0.0.1:4001',
    url: 'http://127.0.0.1:4001/#session=test',
    closed,
    close: async () => finish(),
  }));
  const required: string[] = [];
  const realRequire = createRequire(resolve('dist/index.cjs'));
  const info = vi.spyOn(hexo.log, 'info').mockImplementation(() => {});
  runInNewContext(await readFile('dist/index.cjs', 'utf8'), {
    hexo,
    __dirname: resolve('dist'),
    process,
    Buffer,
    console,
    require(id: string) {
      required.push(id);
      return id === './author/server.cjs' ? { startAuthorSession } : realRequire(id);
    },
  });
  expect(required).not.toContain('./author/server.cjs');
  const running = hexo.extend.console.get('post-map-editor').call(hexo, { _: [] });
  try {
    await vi.waitFor(() => expect(info).toHaveBeenCalledOnce());
    expect(required.filter((id) => id.includes('author'))).toEqual(['./author/server.cjs']);
    expect(startAuthorSession).toHaveBeenCalledExactlyOnceWith({
      port: 4001,
      rawConfig: hexo.config.post_map,
      env: process.env,
    });
    await hexo.extend.filter.exec('before_exit', undefined);
    await running;
  } finally {
    finish();
    await running;
    info.mockRestore();
  }
});

it('serves the standalone compiled entry assets relative to its own bundle directory', async () => {
  const realRequire = createRequire(resolve('dist/author/server.cjs'));
  const entry = realRequire('./server.cjs') as AuthorSessionModule;
  // Ephemeral bind is confined to this entry test; the public command rejects port zero.
  const session = await entry.startAuthorSession({ port: 0, rawConfig: undefined, env: {} });
  try {
    for (const [path, filename] of [
      ['/', 'editor.html'],
      ['/assets/editor.js', 'editor.js'],
      ['/assets/editor.css', 'editor.css'],
    ]) {
      const response = await fetch(session.origin + path);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(await readFile(`dist/author/${filename}`, 'utf8'));
    }
    const response = await fetch(session.origin + '/api/bootstrap', {
      headers: { 'X-HPM-Editor-Session': new URL(session.url).hash.slice('#session='.length) },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: 1, mode: 'manual' });
  } finally {
    await session.close();
  }
});
