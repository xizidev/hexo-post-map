import { access, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = resolve(projectRoot, 'dist');

// Browser tasks declare their source/output pairs here when those sources exist.
const browserEntries = [];

await rm(distDirectory, { force: true, recursive: true });
await mkdir(resolve(distDirectory, 'assets'), { recursive: true });

await build({
  bundle: true,
  entryPoints: [resolve(projectRoot, 'src/index.ts')],
  external: ['hexo'],
  format: 'cjs',
  legalComments: 'eof',
  outfile: resolve(distDirectory, 'index.cjs'),
  platform: 'node',
  sourcemap: false,
  target: 'node20',
});

for (const entry of browserEntries) {
  const source = resolve(projectRoot, entry.source);

  try {
    await access(source);
  } catch {
    throw new Error(`[hexo-post-map] Declared browser entry is missing: ${entry.source}`);
  }

  await build({
    bundle: true,
    entryPoints: [source],
    format: 'iife',
    legalComments: 'eof',
    outfile: resolve(distDirectory, entry.output),
    platform: 'browser',
    sourcemap: false,
    target: 'es2020',
  });
}
