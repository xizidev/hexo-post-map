import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile, stat, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const serve = args.includes('--serve');
const versions = option('hexo', serve ? '8.1.2' : '7.1.1,7.3.0,8.1.2').split(',');
const themes = option('theme', serve ? 'cactus-minimal' : 'landscape,next,cactus-minimal').split(
  ',',
);
const roots = option('root', serve ? '/blog/' : '/,/blog/').split(',');
assert.ok(
  versions.every((version) => /^\d+\.\d+\.\d+$/u.test(version)),
  'Use exact Hexo versions',
);
assert.ok(
  !serve || (versions.length === 1 && themes.length === 1 && roots.length === 1),
  'Serve accepts one matrix cell',
);
const themePackages = { landscape: 'hexo-theme-landscape@1.1.0', next: 'hexo-theme-next@8.29.0' };
const dummyKey = 'hpm-build-only-key';
const dummyCode = 'hpm-build-only-security';
const environment = { ...process.env, npm_config_ignore_scripts: 'true' };
for (const key of Object.keys(environment))
  if (key.startsWith('HEXO_POST_MAP_')) delete environment[key];
function run(command, arguments_, cwd, env = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      env: { ...environment, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolveResult({ code, output, stdout }));
  });
}
function success(result, label) {
  assert.equal(
    result.code,
    0,
    `${label} failed\n${result.output.replaceAll(dummyKey, '[redacted]').replaceAll(dummyCode, '[redacted]')}`,
  );
  return result.stdout;
}
const temporary = await mkdtemp(join(tmpdir(), 'hpm-packed-'));
assert.ok(dirname(temporary) === tmpdir() && basename(temporary).startsWith('hpm-packed-'));
let server;
try {
  const pack = JSON.parse(
    success(
      await run(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary],
        repository,
      ),
      'npm pack',
    ),
  )[0];
  assert.ok(pack.files.some((file) => file.path === 'dist/index.cjs'));
  assert.ok(
    pack.files.every((file) =>
      /^(dist\/|README(?:\.zh-CN)?\.md$|LICENSE$|package\.json$)/u.test(file.path),
    ),
  );
  const tarball = join(temporary, pack.filename);
  for (const version of versions)
    for (const theme of themes) {
      assert.ok(theme === 'cactus-minimal' || theme in themePackages, 'Unknown theme');
      const site = join(temporary, `hexo-${version}-${theme}`);
      await cp(join(repository, 'fixtures/sites/base'), site, { recursive: true });
      await writeFile(
        join(site, 'package.json'),
        JSON.stringify({
          private: true,
          hexo: { version },
          scripts: { postinstall: 'node -e "process.exit(91)"' },
        }),
      );
      const packages = [
        tarball,
        `hexo@${version}`,
        'hexo-cli@4.3.2',
        'hexo-renderer-marked@7.0.1',
        'hexo-renderer-ejs@2.0.0',
        'hexo-renderer-stylus@3.0.1',
        'hexo-generator-index@4.0.0',
      ];
      if (themePackages[theme]) packages.push(themePackages[theme]);
      success(
        await run(
          'npm',
          ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...packages],
          site,
        ),
        'tarball install',
      );
      const installed = JSON.parse(
        await readFile(join(site, 'node_modules/hexo/package.json'), 'utf8'),
      );
      assert.equal(installed.version, version);
      let themeVersion = 'committed';
      if (themePackages[theme]) {
        const [name, expectedVersion] = themePackages[theme].split('@');
        themeVersion = JSON.parse(
          await readFile(join(site, 'node_modules', name, 'package.json'), 'utf8'),
        ).version;
        assert.equal(themeVersion, expectedVersion);
      }
      const lock = JSON.parse(await readFile(join(site, 'package-lock.json'), 'utf8'));
      assert.equal(lock.packages['node_modules/hexo-post-map'].link, undefined);
      assert.ok(lock.packages['node_modules/hexo-post-map'].resolved.endsWith(pack.filename));
      if (theme === 'cactus-minimal')
        await cp(
          join(repository, 'fixtures/themes/cactus-minimal'),
          join(site, 'themes/cactus-minimal'),
          { recursive: true },
        );
      const base = parse(
        await readFile(join(repository, 'fixtures/sites/base/_config.yml'), 'utf8'),
      );
      for (const root of roots) {
        assert.ok(root === '/' || root === '/blog/');
        const config = { ...base, theme, root, url: `https://example.test${root}` };
        const publicDirectory = join(site, 'public');
        const generate = async (settings, env = {}) => {
          await writeFile(join(site, '_config.yml'), stringify(settings));
          success(
            await run(process.execPath, ['node_modules/hexo/bin/hexo', 'clean'], site),
            'hexo clean',
          );
          return run(process.execPath, ['node_modules/hexo/bin/hexo', 'generate'], site, env);
        };
        if (!serve) {
          success(await generate(config), 'unconfigured no-op');
          assert.equal(
            await access(join(publicDirectory, 'map')).then(
              () => true,
              () => false,
            ),
            false,
          );
          assert.equal(
            await access(join(publicDirectory, 'hexo-post-map')).then(
              () => true,
              () => false,
            ),
            false,
          );
          const plain = await readFile(join(publicDirectory, 'posts/plain/index.html'), 'utf8');
          assert.ok(!plain.includes('data-hpm-') && !plain.includes('hexo-post-map/assets'));
          const badPost = join(site, 'source/_posts/invalid.md');
          await writeFile(
            badPost,
            '---\ntitle: Invalid\nmap:\n  points:\n    - id: invalid\n      name: Invalid\n      longitude: 999\n      latitude: 31\n---\nInvalid post.\n',
          );
          const invalid = await generate(
            { ...config, post_map: { enabled: true, amap: {} } },
            { HEXO_POST_MAP_AMAP_KEY: dummyKey, HEXO_POST_MAP_AMAP_SECURITY_JS_CODE: dummyCode },
          );
          assert.notEqual(invalid.code, 0, 'Invalid post metadata must fail hexo generate');
          assert.ok(
            invalid.output.includes('_posts/invalid.md') &&
              invalid.output.includes('map.points[0].longitude'),
            'Invalid post diagnostic must identify source and field',
          );
          assert.ok(
            !invalid.output.includes(dummyKey) && !invalid.output.includes(dummyCode),
            'Post diagnostic leaked credentials',
          );
          await rm(badPost);
          const invalidConfig = await generate({
            ...config,
            post_map: {
              enabled: true,
              amap: {
                key: dummyKey,
                security: {
                  security_js_code: dummyCode,
                  service_host: 'https://example.test/proxy',
                },
              },
            },
          });
          assert.ok(
            !invalidConfig.output.includes(dummyKey) && !invalidConfig.output.includes(dummyCode),
            'Configuration diagnostic leaked credentials',
          );
          assert.ok(
            invalidConfig.output.includes('amap.security'),
            `Invalid configuration must identify its field\n${invalidConfig.output.replaceAll(dummyKey, '[redacted]').replaceAll(dummyCode, '[redacted]')}`,
          );
          assert.notEqual(
            invalidConfig.code,
            0,
            'Invalid plugin configuration must fail hexo generate',
          );
        }
        const generated = await generate(
          { ...config, post_map: { enabled: true, amap: {} } },
          {
            HEXO_POST_MAP_AMAP_KEY: dummyKey,
            HEXO_POST_MAP_AMAP_SECURITY_JS_CODE: dummyCode,
          },
        );
        success(generated, 'hexo generate');
        success(
          await run(
            process.execPath,
            ['node_modules/vitest/vitest.mjs', 'run', 'test/integration/generated-output.test.ts'],
            repository,
            {
              HPM_INTEGRATION_SITE: publicDirectory,
              HPM_INTEGRATION_ROOT: root,
            },
          ),
          'generated output',
        );
        console.log(`PASS Hexo ${installed.version} / ${theme} ${themeVersion} / ${root}`);
        if (serve) {
          server = createServer(async (request, response) => {
            try {
              const pathname = decodeURIComponent(
                new URL(request.url, 'http://localhost').pathname,
              );
              if (!pathname.startsWith(root)) {
                response.writeHead(404).end();
                return;
              }
              let path = resolve(publicDirectory, pathname.slice(root.length));
              if (!path.startsWith(`${publicDirectory}${sep}`) && path !== publicDirectory) {
                response.writeHead(403).end();
                return;
              }
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
              response.writeHead(200, { 'Content-Type': type });
              response.end(await readFile(path));
            } catch {
              response.writeHead(404).end();
            }
          });
          await new Promise((ready, reject) => {
            server.once('error', reject);
            server.listen(4179, '127.0.0.1', ready);
          });
          console.log(`Packed fixture ready on http://127.0.0.1:4179${root}map/`);
          await new Promise((done) => {
            process.once('SIGTERM', done);
            process.once('SIGINT', done);
          });
        }
      }
    }
} finally {
  if (server?.listening) await new Promise((done) => server.close(done));
  await rm(temporary, { recursive: true, force: true });
}
