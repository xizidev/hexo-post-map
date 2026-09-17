import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
  symlink,
  chmod,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { expect, it, vi } from 'vitest';

const runner = resolve('test/integration/real-blog-smoke.mjs');
const execute = promisify(execFile);
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

it.each(['absolute', 'parent', 'empty', 'dot', 'windows'])(
  'rejects unsafe %s output paths before any cleanup can reach an external sentinel',
  async (kind) => {
    const source = await fixture();
    const external = await mkdtemp(join(tmpdir(), 'hpm-output-sentinel-'));
    await writeFile(join(external, 'keep'), 'must survive');
    let workspace = '';
    try {
      const { withBlogCopy, configureCopy } = await import(runner);
      await expect(
        withBlogCopy(source, async ({ site }: { site: string }) => {
          workspace = site;
          const unsafe =
            kind === 'absolute'
              ? external
              : kind === 'parent'
                ? relative(site, external)
                : kind === 'empty'
                  ? ''
                  : kind === 'windows'
                    ? 'C:\\outside'
                    : '.';
          await writeFile(
            join(site, '_config.yml'),
            `url: https://lifeifan.com\npublic_dir: ${JSON.stringify(unsafe)}\n`,
          );
          await configureCopy(site, '/');
          throw new Error('unsafe config reached cleanup');
        }),
      ).rejects.toThrow(/unsafe.*public_dir/i);
      expect(await readFile(join(external, 'keep'), 'utf8')).toBe('must survive');
      expect(await exists(workspace)).toBe(false);
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  },
);

it.each(['new', 'existing'])(
  'detects credentials written into a %s ignored log and still cleans the workspace',
  async (kind) => {
    const source = await fixture();
    let workspace = '';
    try {
      await execute('git', ['init', '-q'], { cwd: source });
      await writeFile(join(source, '.gitignore'), 'ignored.log\n');
      await execute('git', ['add', '.'], { cwd: source });
      await execute(
        'git',
        [
          '-c',
          'user.name=Smoke',
          '-c',
          'user.email=smoke@example.test',
          'commit',
          '-qm',
          'fixture',
        ],
        { cwd: source },
      );
      if (kind === 'existing') await writeFile(join(source, 'ignored.log'), 'safe log');
      const { withAuditedWorkspace } = await import(runner);
      expect(typeof withAuditedWorkspace).toBe('function');
      await expect(
        withAuditedWorkspace([source], async ({ temporary }: { temporary: string }) => {
          workspace = temporary;
          await writeFile(join(source, 'ignored.log'), 'build-smoke-' + 'key');
        }),
      ).rejects.toThrow(/credentials escaped/i);
      expect(await exists(workspace)).toBe(false);
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === 'win32')(
  'full runner SIGTERM completes repository audits before deleting its workspace',
  async () => {
    const source = await fixture();
    const control = await mkdtemp(join(tmpdir(), 'hpm-full-cancel-'));
    const bin = join(control, 'bin');
    await mkdir(bin);
    const npm = join(bin, 'npm');
    await writeFile(join(source, 'smoke-marker'), control);
    await writeFile(
      npm,
      `#!${process.execPath}
const { writeFileSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const temporary = readdirSync(tmpdir()).filter(name => name.startsWith('hpm-packed-')).map(name => join(tmpdir(), name)).find(path => {
  try { return readFileSync(join(path, 'site/smoke-marker'), 'utf8') === ${JSON.stringify(control)}; } catch { return false; }
});
writeFileSync(${JSON.stringify(join(control, 'ready'))}, JSON.stringify({ temporary }));
setInterval(() => {}, 1000);
`,
    );
    await chmod(npm, 0o755);
    await execute('git', ['init', '-q'], { cwd: source });
    await execute('git', ['add', '.'], { cwd: source });
    await execute(
      'git',
      ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'],
      { cwd: source },
    );
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { runRealBlogSmoke } from ${JSON.stringify(runner)}; await runRealBlogSmoke(${JSON.stringify(source)});`,
      ],
      { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: 'pipe' },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const closed = new Promise((done) =>
      child.once('close', (code, signal) => done({ code, signal })),
    );
    try {
      await vi.waitFor(async () => expect(await exists(join(control, 'ready'))).toBe(true), {
        timeout: 10000,
      });
      child.kill('SIGTERM');
      await expect(closed).resolves.toEqual({ code: 143, signal: null });
      expect(output).toContain(`PASS repository audit: ${await realpath(source)}`);
      expect(output).toContain('PASS repository audit: ' + resolve('.'));
      expect(output).not.toContain('Smoke credentials escaped');
      const { temporary } = JSON.parse(await readFile(join(control, 'ready'), 'utf8'));
      expect(typeof temporary).toBe('string');
      expect(await exists(temporary)).toBe(false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
      await rm(source, { recursive: true, force: true });
      await rm(control, { recursive: true, force: true });
    }
  },
  15000,
);

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
