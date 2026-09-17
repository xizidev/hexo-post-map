import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';

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
  it('reports that the plugin has loaded through the Hexo logger', async () => {
    const { registerPlugin } = await import('../src/hexo/register');
    const debug = vi.fn();

    registerPlugin({ log: { debug } } as never);

    expect(debug).toHaveBeenCalledExactlyOnceWith('[hexo-post-map] loaded');
  });
});

describe('package build', () => {
  it('produces the CommonJS plugin entry', async () => {
    await execFileAsync(process.execPath, ['scripts/build.mjs']);

    const entry = await readFile('dist/index.cjs', 'utf8');
    expect(entry.length).toBeGreaterThan(0);
  });
});
