import { access, copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = resolve(projectRoot, 'dist');

const browserEntries = [
  { source: 'src/browser/detail/index.ts', output: 'assets/post-map.js' },
  { source: 'src/browser/overview/index.ts', output: 'assets/overview-map.js' },
  { source: 'src/browser/styles/index.css', output: 'assets/style.css' },
];

await rm(distDirectory, { force: true, recursive: true });
await mkdir(resolve(distDirectory, 'assets'), { recursive: true });
await copyFile(
  resolve(projectRoot, 'src/browser/styles/placeholder.svg'),
  resolve(distDirectory, 'assets/placeholder.svg'),
);

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
    minify: true,
    sourcemap: false,
    target: 'es2020',
  });
}
