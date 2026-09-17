import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
  it('produces the CommonJS plugin entry', async () => {
    await execFileAsync(process.execPath, ['scripts/build.mjs']);

    const entry = await readFile('dist/index.cjs', 'utf8');
    expect(entry.length).toBeGreaterThan(0);
  });
});
