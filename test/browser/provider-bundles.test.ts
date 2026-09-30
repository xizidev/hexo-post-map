import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function productionInputs(entry: string): Promise<string[]> {
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
  return Object.keys(result.metafile.inputs).map((input) =>
    relative(projectRoot, resolve(projectRoot, input)).replaceAll('\\', '/'),
  );
}

describe('browser provider bundle boundaries', () => {
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
