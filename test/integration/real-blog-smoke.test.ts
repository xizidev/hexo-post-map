import { mkdtemp, mkdir, readFile, writeFile, rm, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parse } from 'yaml';
import { expect, it, vi } from 'vitest';

const runner = resolve('test/integration/real-blog-smoke.mjs');
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'hpm-blog-proof-'));
  for (const path of ['source/_posts', 'themes/cactus', '.git', 'public', 'node_modules', '.cache'])
    await mkdir(join(directory, path), { recursive: true });
  await writeFile(join(directory, '_config.yml'), 'url: https://lifeifan.com\ntheme: cactus\n');
  await writeFile(join(directory, 'themes/cactus/_config.yml'), 'nav:\n  home: /\n');
  await writeFile(
    join(directory, 'source/_posts/魔都.md'),
    '---\ntitle: 魔都\nurlname: shanghai-230304\n---\n\nOriginal body\n---\n',
  );
  await writeFile(join(directory, 'db.json'), '{}');
  return directory;
}

it('copies only source inputs and patches YAML and front matter without changing the original', async () => {
  const source = await fixture();
  let workspace = '';
  try {
    expect(await exists(runner), 'real blog smoke runner must exist').toBe(true);
    const { withBlogCopy, configureCopy } = await import(runner);
    await withBlogCopy(source, async ({ site }: { site: string }) => {
      workspace = site;
      for (const excluded of ['.git', 'public', 'node_modules', '.cache', 'db.json'])
        expect(await exists(join(site, excluded))).toBe(false);
      await configureCopy(site, '/blog/');
      const config = parse(await readFile(join(site, '_config.yml'), 'utf8'));
      expect(config.root).toBe('/blog/');
      expect(config.url).toBe('https://lifeifan.com/blog/');
      expect(config.post_map.enabled).toBe(true);
      expect(JSON.stringify(config)).not.toMatch(/build-smoke|security_js_code/);
      expect(parse(await readFile(join(site, 'themes/cactus/_config.yml'), 'utf8')).nav.map).toBe(
        '/map/',
      );
      const article = await readFile(join(site, 'source/_posts/魔都.md'), 'utf8');
      expect(article).toContain('longitude: 121.4737');
      expect(article).toContain('latitude: 31.2304');
      expect(article).toContain('\n\nOriginal body\n---\n');
    });
    expect(await exists(workspace)).toBe(false);
    expect(await readFile(join(source, '_config.yml'), 'utf8')).toBe(
      'url: https://lifeifan.com\ntheme: cactus\n',
    );
    expect(await readFile(join(source, 'source/_posts/魔都.md'), 'utf8')).not.toContain('map:');
  } finally {
    await rm(source, { recursive: true, force: true });
  }
});

it('cleans the temporary copy after exceptions and rejects symlink write-through', async () => {
  const source = await fixture();
  let workspace = '';
  try {
    expect(await exists(runner)).toBe(true);
    const { withBlogCopy } = await import(runner);
    await expect(
      withBlogCopy(source, async ({ site }: { site: string }) => {
        workspace = site;
        throw new Error('injected build failure');
      }),
    ).rejects.toThrow('injected build failure');
    expect(await exists(workspace)).toBe(false);
    await symlink(join(source, '_config.yml'), join(source, 'linked.yml'));
    await expect(withBlogCopy(source, () => {})).rejects.toThrow(/symlink/i);
  } finally {
    await rm(source, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === 'win32')(
  'SIGTERM waits for the build child and removes the real-blog temporary copy',
  async () => {
    const source = await fixture();
    const control = await mkdtemp(join(tmpdir(), 'hpm-blog-control-'));
    const child = spawn(
      process.execPath,
      [resolve('test/integration/real-blog-cancel-fixture.mjs'), source, control],
      { stdio: 'pipe' },
    );
    const closed = new Promise((done) =>
      child.once('close', (code, signal) => done({ code, signal })),
    );
    try {
      await vi.waitFor(async () => expect(await exists(join(control, 'ready.json'))).toBe(true), {
        timeout: 5000,
      });
      const { temporary } = JSON.parse(await readFile(join(control, 'workspace.json'), 'utf8'));
      child.kill('SIGTERM');
      await expect(closed).resolves.toEqual({ code: 143, signal: null });
      expect(
        JSON.parse(await readFile(join(control, 'child-exit.json'), 'utf8')).workspaceStillPresent,
      ).toBe(true);
      expect(await exists(temporary)).toBe(false);
      expect(await exists(join(control, 'next-stage'))).toBe(false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
      await rm(source, { recursive: true, force: true });
      await rm(control, { recursive: true, force: true });
    }
  },
  10000,
);
