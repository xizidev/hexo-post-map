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
