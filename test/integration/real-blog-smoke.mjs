import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, lstat, readFile, writeFile, readdir, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, stringify } from 'yaml';
import { Window } from 'happy-dom';
import { normalizeNpmPackJson } from '../../scripts/npm-pack-json.mjs';
import { withTemporaryWorkspace } from './runner-lifecycle.mjs';

const filename = fileURLToPath(import.meta.url);
const repository = resolve(dirname(filename), '../..');
const defaultBlog = '/Users/hif/blog/blog_source';
const smokeKey = 'build-smoke-' + 'key';
const smokeCode = 'build-smoke-' + 'code';
const imageUrl = 'https://oss.qiuchang.cc/img_p/shanghai/DSCF9176.JPG';
const articleRoute = 'archives/shanghai-230304/';
const excluded = new Set([
  '.git',
  'public',
  'node_modules',
  '.cache',
  '.parcel-cache',
  '.hexo',
  'db.json',
  '.codex-worktrees',
  '.worktrees',
  '.superpowers',
  '.codex',
  '.agents',
]);
const execute = promisify(execFile);
const auditExclusions = new Set([
  '.git',
  'node_modules',
  '.superpowers',
  '.codex',
  '.agents',
  '.worktrees',
  '.codex-worktrees',
]);

async function readOnlyGit(command, args, cwd) {
  assert.equal(command, 'git');
  assert.ok(
    [
      ['branch', '--show-current'],
      ['rev-parse', 'HEAD'],
      ['status', '--porcelain=v1', '--untracked-files=all'],
      ['diff', '--check'],
    ].some((allowed) => JSON.stringify(allowed) === JSON.stringify(args)),
    'Only fixed read-only audit commands are allowed',
  );
  const { stdout, stderr } = await execute(
    'git',
    ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
    {
      cwd,
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  return { code: 0, stdout, output: stdout + stderr };
}

export async function withAuditedWorkspace(directories, work) {
  const baselines = [];
  return withTemporaryWorkspace(
    async (context) => {
      for (const directory of directories) {
        const baseline = await snapshot(readOnlyGit, directory);
        baselines.push({ baseline, files: await credentialInventory(baseline.directory) });
      }
      return work(context);
    },
    {
      afterStop: async () => {
        const failures = [];
        for (const { baseline, files } of baselines) {
          const checks = await Promise.allSettled([
            snapshot(readOnlyGit, baseline.directory).then((current) =>
              assert.deepEqual(current, baseline, 'A real repository changed during smoke'),
            ),
            readOnlyGit('git', ['diff', '--check'], baseline.directory).then((result) =>
              success(result, 'repository diff check'),
            ),
            credentialInventory(baseline.directory).then((current) => {
              const credentialFiles = (inventory) =>
                Object.fromEntries(
                  Object.entries(inventory).filter(([, value]) => value.credential),
                );
              assert.deepEqual(
                credentialFiles(current),
                credentialFiles(files),
                'Smoke credentials escaped into a repository',
              );
              assert.deepEqual(current, files, 'Repository file bytes changed during smoke');
            }),
          ]);
          const failed = checks.filter((result) => result.status === 'rejected');
          failures.push(...failed.map((result) => result.reason));
          if (failed.length === 0) console.log(`PASS repository audit: ${baseline.directory}`);
        }
        if (failures.length === 1) throw failures[0];
        if (failures.length) throw new AggregateError(failures, 'Repository audits failed');
      },
    },
  );
}

function yamlObject(text) {
  const document = parseDocument(text, { uniqueKeys: true });
  assert.equal(document.errors.length, 0, 'Invalid YAML input');
  assert.equal(document.warnings.length, 0, 'Unsupported YAML input');
  const value = document.toJS({ maxAliasCount: 20 });
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected YAML object');
  return value;
}

export async function withBlogCopy(blog, work) {
  return withTemporaryWorkspace(async (context) => {
    const site = join(context.temporary, 'site');
    await copyBlog(blog, site);
    return work({ ...context, site });
  });
}

async function copyBlog(blog, site) {
  const source = await realpath(blog);
  await cp(source, site, {
    recursive: true,
    filter: async (path) => {
      if (
        relative(source, path)
          .split(sep)
          .some((part) => excluded.has(part))
      )
        return false;
      assert.ok(!(await lstat(path)).isSymbolicLink(), 'Blog source symlinks are not supported');
      return true;
    },
  });
}

export async function configureCopy(site, root) {
  assert.ok(root === '/' || root === '/blog/');
  const configPath = join(site, '_config.yml');
  const config = yamlObject(await readFile(configPath, 'utf8'));
  for (const [key, value] of Object.entries(config)) {
    if (!key.endsWith('_dir')) continue;
    assert.ok(
      typeof value === 'string' &&
        value.length > 0 &&
        value.trim() === value &&
        !isAbsolute(value) &&
        !/[\\\u0000-\u001f\u007f]/u.test(value) &&
        !/^[a-z]:/iu.test(value) &&
        value.split('/').every((part) => part !== '.' && part !== '..' && part !== ''),
      `Unsafe output directory: ${key}`,
    );
    const target = resolve(site, value);
    assert.ok(target.startsWith(`${resolve(site)}${sep}`), `Unsafe output directory: ${key}`);
  }
  // Hexo clean removes this directory recursively. Never inherit its destination.
  config.public_dir = 'public';
  config.url = `https://lifeifan.com${root}`;
  config.root = root;
  config.post_map = {
    enabled: true,
    provider: 'amap',
    post: { enabled: true, position: 'before', height: '220px', default_zoom: 11 },
    overview: { enabled: true, path: 'map/', title: '足迹地图', layout: 'page' },
    amap: {}, // Client security is selected by environment only; never serialize credentials.
  };
  await writeFile(configPath, stringify(config));
  const themePath = join(site, 'themes/cactus/_config.yml');
  const theme = yamlObject(await readFile(themePath, 'utf8'));
  theme.nav = { ...theme.nav, map: '/map/' };
  await writeFile(themePath, stringify(theme));
  const postPath = join(site, 'source/_posts/魔都.md');
  // The live blog can gain maps over time. Normalize only this disposable copy
  // to one mapped article so the Shanghai preview remains a deterministic fixture.
  for (const path of await filesWithExtension(join(site, 'source/_posts'), '.md')) {
    if (path === postPath) continue;
    const contents = await readFile(path, 'utf8');
    const frontMatter = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(contents);
    if (!frontMatter) continue;
    const metadata = yamlObject(frontMatter[1]);
    if (!Object.hasOwn(metadata, 'map')) continue;
    delete metadata.map;
    await writeFile(
      path,
      `---\n${stringify(metadata)}---\n${contents.slice(frontMatter[0].length)}`,
    );
  }
  const post = await readFile(postPath, 'utf8');
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(post);
  assert.ok(match, 'Shanghai article must have YAML front matter');
  const metadata = yamlObject(match[1]);
  metadata.thumbnail = imageUrl;
  metadata.map = {
    points: [{ id: 'shanghai', name: '上海', longitude: 121.4737, latitude: 31.2304 }],
  };
  await writeFile(postPath, `---\n${stringify(metadata)}---\n${post.slice(match[0].length)}`);
}

function success(result, label) {
  assert.equal(
    result.code,
    0,
    `${label} failed\n${result.output.replaceAll(smokeKey, '[redacted]').replaceAll(smokeCode, '[redacted]')}`,
  );
  return result.stdout;
}

async function snapshot(run, directory) {
  const git = async (args) => success(await run('git', args, directory), 'git baseline');
  return {
    directory: await realpath(directory),
    branch: (await git(['branch', '--show-current'])).trim(),
    head: (await git(['rev-parse', 'HEAD'])).trim(),
    status: await git(['status', '--porcelain=v1', '--untracked-files=all']),
  };
}

async function credentialInventory(directory) {
  const files = {};
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (auditExclusions.has(entry.name)) continue;
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        const contents = await readFile(absolute);
        files[relative(directory, absolute)] = {
          hash: createHash('sha256').update(contents).digest('hex'),
          credential: contents.includes(smokeKey) || contents.includes(smokeCode),
        };
      }
    }
  }
  await visit(directory);
  return files;
}

async function filesWithExtension(directory, extension) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await filesWithExtension(path, extension)));
    else if (entry.name.endsWith(extension)) found.push(path);
  }
  return found;
}

async function verifyGenerated(site, root) {
  const output = join(site, 'public');
  const detail = await readFile(join(output, articleRoute, 'index.html'), 'utf8');
  assert.ok(detail.includes('data-hpm-detail'), 'Shanghai detail card missing');
  assert.ok(
    detail.includes(`https://lifeifan.com${root}${articleRoute}`),
    'Canonical article URL has the wrong root',
  );
  const overview = await readFile(join(output, 'map/index.html'), 'utf8');
  assert.ok(overview.includes('data-hpm-overview'));
  assert.ok(overview.includes(`${root}map/posts.json`));
  assert.ok(overview.includes(`href="${root}${articleRoute}"`));
  assert.ok(detail.includes(`href="${root}map/"`), 'Cactus map navigation does not respect root');
  const data = JSON.parse(await readFile(join(output, 'map/posts.json'), 'utf8'));
  assert.equal(data.version, 1);
  assert.equal(data.posts.length, 1, 'Only the copied Shanghai article should be mapped');
  assert.deepEqual(Object.keys(data.posts[0]).sort(), [
    'date',
    'image',
    'location',
    'title',
    'url',
  ]);
  assert.deepEqual(data.posts[0].location, {
    name: '上海',
    longitude: 121.4737,
    latitude: 31.2304,
  });
  assert.equal(data.posts[0].url, `${root}${articleRoute}`);
  assert.equal(data.posts[0].image, imageUrl);
  for (const asset of [
    'runtime.js',
    'style.css',
    'post-map.js',
    'overview-map.js',
    'placeholder.svg',
  ])
    assert.ok((await readFile(join(output, 'hexo-post-map/assets', asset))).length > 0);
  let ordinary = 0;
  let ordinaryRoute;
  for (const path of await filesWithExtension(output, '.html')) {
    const window = new Window({
      settings: {
        disableJavaScriptEvaluation: true,
        disableJavaScriptFileLoading: true,
        disableCSSFileLoading: true,
      },
    });
    try {
      window.document.write(await readFile(path, 'utf8'));
      const document = window.document;
      const route = relative(output, path).split(sep).join('/');
      assert.deepEqual(
        [...document.querySelectorAll('script[src]')]
          .map((script) => script.getAttribute('src'))
          .filter((src) => src?.includes('hexo-post-map/assets/')),
        [`${root}hexo-post-map/assets/runtime.js`],
        `Runtime/feature scripts: ${route}`,
      );
      const mapRoot = document.querySelector('[data-hpm-detail], [data-hpm-overview]');
      assert.equal(
        document.querySelectorAll(`link[href="${root}hexo-post-map/assets/style.css"]`).length,
        mapRoot ? 1 : 0,
        route,
      );
      if (mapRoot) {
        assert.ok(
          mapRoot.querySelector('[data-hpm-fallback] a'),
          `Static fallback missing: ${route}`,
        );
      } else {
        assert.equal(
          document.querySelector(
            '[data-hpm-detail], [data-hpm-overview], .hpm-detail-marker, .hpm-image-marker, .hpm-cluster',
          ),
          null,
          route,
        );
        assert.equal(document.querySelector('link[href*="hexo-post-map/assets/"]'), null, route);
        if (route.startsWith('archives/')) {
          ordinary++;
          ordinaryRoute ??= `${root}${route.replace(/index\.html$/u, '')}`;
        }
      }
    } finally {
      await window.happyDOM.close();
    }
  }
  assert.ok(ordinary > 0, 'Expected ordinary articles in the real blog');
  return { ordinary, ordinaryRoute };
}

async function browserSmoke(site, root, ordinaryRoute) {
  const { chromium } = await import('playwright');
  const { expect } = await import('playwright/test');
  const { transform } = await import('esbuild');
  const transformed = await transform(await readFile(join(repository, 'e2e/fake-sdk.ts'), 'utf8'), {
    loader: 'ts',
    format: 'esm',
  });
  const { fakeSdk } = await import(
    `data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`
  );
  const output = join(site, 'public');
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      assert.ok(pathname.startsWith(root));
      let path = resolve(output, pathname.slice(root.length));
      assert.ok(path === output || path.startsWith(`${output}${sep}`));
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      const type = path.endsWith('.js')
        ? 'text/javascript'
        : path.endsWith('.css')
          ? 'text/css'
          : path.endsWith('.json')
            ? 'application/json'
            : path.endsWith('.svg')
              ? 'image/svg+xml'
              : 'text/html';
      response.writeHead(200, { 'Content-Type': type }).end(await readFile(path));
    } catch {
      response.writeHead(404).end();
    }
  });
  let browser;
  try {
    await new Promise((ready, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', ready);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: 'chromium' });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    let sdkRequests = 0;
    const local = {};
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) {
        local[url.pathname] = (local[url.pathname] ?? 0) + 1;
        await route.continue();
      } else if (url.hostname === 'webapi.amap.com' && url.pathname === '/maps') {
        sdkRequests++;
        await route.fulfill({ contentType: 'text/javascript', body: fakeSdk });
      } else if (url.href === imageUrl)
        await route.fulfill({
          contentType: 'image/png',
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=',
            'base64',
          ),
        });
      else await route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(`${origin}${ordinaryRoute}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(`script[src="${root}hexo-post-map/assets/runtime.js"]`)).toHaveCount(
      1,
    );
    await expect(
      page.locator(
        '[data-hpm-detail], [data-hpm-overview], link[href*="hexo-post-map/assets/"], script[src$="post-map.js"], script[src$="overview-map.js"]',
      ),
    ).toHaveCount(0);
    assert.equal(sdkRequests, 0);
    const replaceMap = (path) =>
      page.evaluate(async (path) => {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`PJAX fetch failed: ${response.status}`);
        const target = new DOMParser().parseFromString(await response.text(), 'text/html');
        const root = target.querySelector('[data-hpm-detail], [data-hpm-overview]');
        if (!root) throw new Error('PJAX map root missing');
        let host = document.querySelector('#hpm-smoke-host');
        if (!host) {
          host = document.createElement('main');
          host.id = 'hpm-smoke-host';
          document.body.append(host);
        }
        host.replaceChildren(document.importNode(root, true));
      }, path);
    await replaceMap(`${root}${articleRoute}`);
    await expect(page.locator('#hpm-smoke-host [data-hpm-detail]')).toHaveAttribute(
      'data-hpm-active',
      'true',
    );
    await replaceMap(`${root}map/`);
    await expect(page.locator('#hpm-smoke-host [data-hpm-overview]')).toHaveAttribute(
      'data-hpm-active',
      'true',
    );
    for (const asset of ['runtime.js', 'style.css', 'post-map.js', 'overview-map.js'])
      assert.equal(local[`${root}hexo-post-map/assets/${asset}`], 1, asset);
    assert.equal(local[`${root}map/posts.json`], 1);
    assert.equal(sdkRequests, 1);
    await expect(page).toHaveURL(`${origin}${ordinaryRoute}`);

    await page.goto(`${origin}${root}${articleRoute}`, { waitUntil: 'domcontentloaded' });
    const detail = page.locator('[data-hpm-detail]');
    await expect(detail).toBeVisible();
    await expect(detail).toHaveAttribute('data-hpm-active', 'true');
    await detail.getByRole('button', { name: '显示地点：上海', exact: true }).click();
    await expect(detail.getByRole('tooltip')).toBeVisible();
    await expect(detail.getByRole('tooltip')).toHaveText('上海');
    await page.goto(`${origin}${root}map/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-hpm-overview]')).toHaveAttribute('data-hpm-active', 'true');
    await page.getByRole('button', { name: '预览文章：魔都' }).click();
    const preview = page.getByRole('dialog', { name: '1 篇文章' });
    await expect(preview.locator('img')).toHaveAttribute('src', imageUrl);
    await expect
      .poll(() =>
        preview.locator('img').evaluate((image) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    await preview
      .locator('a')
      .filter({ has: page.locator('img') })
      .click();
    await expect(page).toHaveURL(`${origin}${root}${articleRoute}`);
    await expect(page.locator('[data-hpm-detail]')).toHaveAttribute('data-hpm-active', 'true');
    assert.equal(sdkRequests, 4, 'One SDK request per full document, shared by PJAX roots');
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}

export async function runRealBlogSmoke(blog = defaultBlog) {
  const environment = { ...process.env, npm_config_ignore_scripts: 'true' };
  for (const key of Object.keys(environment))
    if (key.startsWith('HEXO_POST_MAP_')) delete environment[key];
  await withAuditedWorkspace([repository, blog], async ({ temporary, run: child }) => {
    const site = join(temporary, 'site');
    const run = (command, args, cwd, env = {}) =>
      child(command, args, cwd, { ...environment, ...env });
    await copyBlog(blog, site);
    await configureCopy(site, '/');
    success(await run('npm', ['run', 'build'], repository), 'plugin build');
    const packs = normalizeNpmPackJson(
      JSON.parse(
        success(
          await run(
            'npm',
            ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary],
            repository,
          ),
          'npm pack',
        ),
      ),
    );
    assert.equal(packs.length, 1);
    const packed = packs[0];
    const tarball = resolve(temporary, packed.filename);
    assert.equal(dirname(tarball), temporary);
    const integrity = `sha512-${createHash('sha512')
      .update(await readFile(tarball))
      .digest('base64')}`;
    success(
      await run(
        'npm',
        ['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
        site,
      ),
      'real blog tarball install',
    );
    const installedPath = join(site, 'node_modules/hexo-post-map');
    assert.ok(!(await lstat(installedPath)).isSymbolicLink());
    const lock = JSON.parse(await readFile(join(site, 'node_modules/.package-lock.json'), 'utf8'));
    assert.equal(lock.packages['node_modules/hexo-post-map'].integrity, integrity);
    assert.ok(lock.packages['node_modules/hexo-post-map'].resolved.endsWith(packed.filename));
    // Hexo discovers plugins from dependencies, even when npm installed them --no-save.
    // Declare the already-installed tarball only in this disposable site's manifest.
    const manifestPath = join(site, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.dependencies = { ...manifest.dependencies, 'hexo-post-map': `file:${tarball}` };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const installed = JSON.parse(
      await readFile(join(site, 'node_modules/hexo/package.json'), 'utf8'),
    );
    for (const root of ['/', '/blog/']) {
      await configureCopy(site, root);
      for (const path of ['_config.yml', 'themes/cactus/_config.yml']) {
        const contents = await readFile(join(site, path), 'utf8');
        assert.ok(!contents.includes(smokeKey) && !contents.includes(smokeCode));
      }
      const smokeEnv = {
        HEXO_POST_MAP_AMAP_KEY: smokeKey,
        HEXO_POST_MAP_AMAP_SECURITY_JS_CODE: smokeCode,
      };
      success(await run('npm', ['run', 'clean'], site, smokeEnv), 'real blog clean');
      success(await run('npm', ['run', 'build'], site, smokeEnv), 'real blog build');
      const { ordinary, ordinaryRoute } = await verifyGenerated(site, root);
      success(
        await run(process.execPath, [filename, '--browser', site, root, ordinaryRoute], repository),
        'real blog browser',
      );
      console.log(
        `PASS real Cactus / Hexo ${installed.version} / ${root}: ordinary-to-map PJAX, Shanghai tooltip, overview image navigation, ${ordinary} ordinary pages`,
      );
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === filename) {
  if (process.argv[2] === '--browser')
    await browserSmoke(process.argv[3], process.argv[4], process.argv[5]);
  else await runRealBlogSmoke();
}
