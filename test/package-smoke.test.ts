import { execFile } from 'node:child_process';
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import Hexo from 'hexo';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { normalizeNpmPackJson } from '../scripts/npm-pack-json.mjs';
import type { HexoRoute } from '../src/hexo/generator';

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
  it('rejects forbidden runtime inputs when invoked outside the project directory', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'hpm-build-guard-'));
    const script = join(fixture, 'scripts/build.mjs');
    const outsideCwd = dirname(fixture);
    try {
      await cp(resolve('src'), join(fixture, 'src'), { recursive: true });
      await mkdir(join(fixture, 'scripts'));
      await cp(resolve('scripts/build.mjs'), script);
      await symlink(
        resolve('node_modules'),
        join(fixture, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      await execFileAsync(process.execPath, [script], { cwd: outsideCwd });
      expect((await stat(join(fixture, 'dist/assets/runtime.js'))).size).toBeGreaterThan(0);

      await writeFile(
        join(fixture, 'src/browser/providers/build-guard-fixture.ts'),
        "console.info('forbidden runtime dependency');\n",
      );
      await appendFile(
        join(fixture, 'src/browser/runtime/index.ts'),
        "\nimport '../providers/build-guard-fixture';\n",
      );
      const failure = await execFileAsync(process.execPath, [script], { cwd: outsideCwd }).then(
        () => null,
        (error: { stderr: string }) => error,
      );
      expect(failure).not.toBeNull();
      expect(failure?.stderr).toContain(
        'Runtime entry imports forbidden source: src/browser/providers/build-guard-fixture.ts',
      );
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('produces the CommonJS entry and readable routes for every browser asset', async () => {
    await execFileAsync(process.execPath, ['scripts/build.mjs']);

    const entry = await readFile('dist/index.cjs', 'utf8');
    expect(entry.length).toBeGreaterThan(0);
    const files = await readdir('dist/assets');
    expect(files.sort()).toEqual([
      'overview-map.js',
      'placeholder.svg',
      'post-map.js',
      'runtime.js',
      'style.css',
    ]);
    expect((await stat('dist/assets/runtime.js')).size).toBeLessThanOrEqual(8192);
    const warnings: string[] = [];
    runInNewContext(await readFile('dist/assets/runtime.js', 'utf8'), {
      document: { currentScript: { src: 'https://example.test/private?config=secret' } },
      HTMLScriptElement: class {},
      console: { warn: (message: string) => warnings.push(message) },
    });
    expect(warnings).toEqual(['HexoPostMap: runtime script element is unavailable.']);
    for (const file of ['post-map.js', 'overview-map.js', 'runtime.js', 'style.css']) {
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
      expect(routes).toHaveLength(5);
      for (const route of routes) {
        let previous: Buffer | undefined;
        for (let read = 0; read < 2; read++) {
          const chunks: Buffer[] = [];
          for await (const chunk of route.data()) chunks.push(Buffer.from(chunk));
          const content = Buffer.concat(chunks);
          expect(content.length).toBeGreaterThan(0);
          if (previous) expect(content).toEqual(previous);
          previous = content;
        }
      }
      await mkdir(join(hexo.source_dir, '_posts'), { recursive: true });
      await writeFile(
        join(hexo.source_dir, '_posts/private-track.gpx'),
        `<gpx xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>PRIVATE_NAME</name></metadata><trk><trkseg>
<trkpt lon="0" lat="0"><ele>10</ele><time>2026-01-01T00:00:00Z</time></trkpt>
<trkpt lon="0.001" lat="0"><ele>20</ele><time>2026-01-01T00:01:00Z</time></trkpt>
</trkseg></trk></gpx>`,
      );
      const post = {
        source: '_posts/trip.md',
        content: '<p>Trip</p>',
        map: {
          points: [{ id: 'shanghai', name: '上海', longitude: 121.4737, latitude: 31.2304 }],
          track: { source: 'private-track.gpx' },
        },
      };
      const rendered = await hexo.extend.filter.exec('after_post_render', post, { context: hexo });
      const window = new Window();
      window.document.body.innerHTML = rendered.content;
      const descriptor = JSON.parse(
        window.document.querySelector('[data-hpm-data]')!.textContent!,
      ).track;
      expect(descriptor?.url).toMatch(/^\/hexo-post-map\/tracks\/[a-f0-9]{64}\.json$/);
      const trackedRoutes: HexoRoute[] = await generator.call(hexo, {
        posts: { toArray: () => [post] },
      } as unknown as Parameters<typeof generator>[0]);
      expect(trackedRoutes).toHaveLength(6);
      const trackRoute = trackedRoutes.find((route) => `/${route.path}` === descriptor.url)!;
      expect(typeof trackRoute.data).toBe('string');
      expect(JSON.parse(String(trackRoute.data)).stats).toEqual({
        distanceMeters: 111.195,
        elevationGainMeters: 10,
        durationSeconds: 60,
      });
      expect(JSON.stringify(trackedRoutes)).not.toMatch(
        /private-track|PRIVATE_NAME|2026-01-01|_posts/,
      );
      expect(rendered.content).not.toMatch(/private-track|PRIVATE_NAME|2026-01-01|_posts/);
      const packed = normalizeNpmPackJson(
        JSON.parse(
          (await execFileAsync('npm', ['pack', '--json', '--dry-run', '--ignore-scripts'])).stdout,
        ),
      );
      expect(
        packed
          .flatMap((item) => item.files.map((file) => file.path))
          .filter((path) => /\.(?:gpx|geojson)$/u.test(path)),
      ).toEqual([]);
    } finally {
      await hexo.exit();
      await rm(temp, { recursive: true, force: true });
    }
  });
});
