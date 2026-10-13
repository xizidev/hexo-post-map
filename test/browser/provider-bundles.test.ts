import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function productionBundle(entry: string): Promise<{ inputs: string[]; bytes: number }> {
  const result = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    entryPoints: [resolve(projectRoot, entry)],
    format: 'iife',
    legalComments: 'eof',
    outfile: resolve(projectRoot, '.bundle-test.js'),
    platform: 'browser',
    minify: true,
    metafile: true,
    sourcemap: false,
    target: 'es2020',
    write: false,
  });
  const inputs = Object.keys(result.metafile.inputs).map((input) =>
    relative(projectRoot, resolve(projectRoot, input)).replaceAll('\\', '/'),
  );
  return { inputs, bytes: result.outputFiles[0]!.contents.length };
}

async function productionInputs(entry: string): Promise<string[]> {
  return (await productionBundle(entry)).inputs;
}

describe('browser provider bundle boundaries', () => {
  it('isolates author Node and browser bundles from every reader entry', async () => {
    for (const entry of ['runtime', 'detail', 'overview']) {
      const bundle = await productionBundle(`src/browser/${entry}/index.ts`);
      expect(
        bundle.inputs.filter((input) =>
          /src\/(?:author|browser\/author)\/|node_modules\/(?:yaml|hexo|vitest)\//u.test(input),
        ),
      ).toEqual([]);
    }
    const author = await build({
      absWorkingDir: projectRoot,
      bundle: true,
      entryPoints: ['src/author/entry.ts'],
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      metafile: true,
      write: false,
    });
    expect(
      Object.keys(author.metafile.inputs).filter((input) =>
        /node_modules\/(?:hexo|vitest|chokidar|yaml)\/|src\/(?:browser|tracks|hexo)\//u.test(input),
      ),
    ).toEqual([]);
    expect(
      Object.values(author.metafile.outputs)
        .flatMap((output) => output.imports)
        .filter((item) => item.path === 'hexo'),
    ).toEqual([]);
    const main = await build({
      absWorkingDir: projectRoot,
      bundle: true,
      entryPoints: ['src/index.ts'],
      external: ['hexo', './author/server.cjs'],
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      metafile: true,
      write: false,
    });
    expect(
      Object.keys(main.metafile.inputs).filter((input) =>
        /src\/(?:author|browser\/author)\/|node_modules\/yaml\//u.test(input),
      ),
    ).toEqual([]);
    expect(Object.values(main.metafile.outputs).flatMap((output) => output.imports)).toContainEqual(
      { path: './author/server.cjs', kind: 'require-call', external: true },
    );
  });
  it('keeps exploration overview-only and the provider-free runtime within 8192 bytes', async () => {
    const [runtime, detail, overview] = await Promise.all([
      productionBundle('src/browser/runtime/index.ts'),
      productionBundle('src/browser/detail/index.ts'),
      productionBundle('src/browser/overview/index.ts'),
    ]);
    expect(runtime.bytes).toBeLessThanOrEqual(8192);
    expect(
      runtime.inputs.filter((input) => /src\/browser\/(providers|overview|detail)\//u.test(input)),
    ).toEqual([]);
    for (const file of [
      'exploration',
      'snapshot',
      'snapshot-cache',
      'share',
      'share-controls',
      'random',
      'post-index',
    ]) {
      const path = `src/browser/overview/${file}.ts`;
      expect(overview.inputs).toContain(path);
      expect(detail.inputs).not.toContain(path);
      expect(runtime.inputs).not.toContain(path);
    }
  });
  it('keeps recorded-track conversion and payload code detail-only', async () => {
    const [detailInputs, overviewInputs] = await Promise.all([
      productionInputs('src/browser/detail/index.ts'),
      productionInputs('src/browser/overview/index.ts'),
    ]);

    const detailOnlyInputs = [
      'src/browser/providers/amap-track.ts',
      'src/browser/detail/track-data.ts',
      'src/tracks/geo.ts',
    ];
    for (const input of detailOnlyInputs) {
      expect(detailInputs).toContain(input);
      expect(overviewInputs).not.toContain(input);
    }
  });
});
