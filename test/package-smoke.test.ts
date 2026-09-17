import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import Hexo from 'hexo';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('package contract', () => {
  it('declares the supported runtime and publish files', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    expect(pkg.name).toBe('hexo-post-map');
    expect(pkg.engines.node).toBe('>=20');
    expect(pkg.peerDependencies.hexo).toBe('>=7 <9');
    expect(pkg.main).toBe('dist/index.cjs');
    expect(pkg.files).toEqual(['dist', 'README.md', 'README.zh-CN.md', 'LICENSE']);
  });
});

describe('registerPlugin', () => {
  it('requires explicit post_map activation even when unrelated site settings include enabled', async () => {
    const { registerPlugin } = await import('../src/hexo/register');
    const hexo = new Hexo('/tmp/hpm-package-smoke');
    hexo.config.enabled = true;
    hexo.config.provider = 'unknown';
    const filterTypes = Object.keys(hexo.extend.filter.list());

    registerPlugin(hexo);

    expect(Object.keys(hexo.extend.filter.list())).toEqual(filterTypes);
    expect(hexo.extend.tag.env.hasExtension('post_map')).toBe(false);
  });
});

describe('package build', () => {
  it('produces the CommonJS entry and readable routes for every browser asset', async () => {
    await execFileAsync(process.execPath, ['scripts/build.mjs']);

    const entry = await readFile('dist/index.cjs', 'utf8');
    expect(entry.length).toBeGreaterThan(0);
    const files = await readdir('dist/assets');
    expect(files.sort()).toEqual([
      'overview-map.js',
      'placeholder.svg',
      'post-map.js',
      'style.css',
    ]);
    for (const file of ['post-map.js', 'overview-map.js', 'style.css']) {
      const content = await readFile(join('dist/assets', file), 'utf8');
      expect(content.length).toBeGreaterThan(0);
      expect(content).not.toContain('sourceMappingURL');
    }
    const temp = await mkdtemp(join(tmpdir(), 'hpm-browser-assets-'));
    const hexo = new Hexo(temp, { silent: true });
    try {
      await hexo.init();
      hexo.config.post_map = {
        enabled: true,
        overview: { enabled: false },
        amap: { key: 'key', security: { security_js_code: 'code' } },
      };
      const previous = Object.getOwnPropertyDescriptor(globalThis, 'hexo');
      Object.defineProperty(globalThis, 'hexo', { configurable: true, value: hexo });
      try {
        const require = createRequire(import.meta.url);
        const entryPath = resolve('dist/index.cjs');
        delete require.cache[entryPath];
        require(entryPath);
      } finally {
        if (previous) Object.defineProperty(globalThis, 'hexo', previous);
        else Reflect.deleteProperty(globalThis, 'hexo');
      }
      const generator = hexo.extend.generator.get('post-map');
      const routes = await generator.call(
        hexo,
        hexo.locals.toObject() as Parameters<typeof generator>[0],
      );
      expect(routes).toHaveLength(4);
      for (const route of routes) {
        const chunks: Buffer[] = [];
        for await (const chunk of route.data()) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks).length).toBeGreaterThan(0);
      }
    } finally {
      await hexo.exit();
      await rm(temp, { recursive: true, force: true });
    }
  });
});
