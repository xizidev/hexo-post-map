import { access, copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = resolve(projectRoot, 'dist');

const browserEntries = [
  { source: 'src/browser/runtime/index.ts', output: 'assets/runtime.js', lightweight: true },
  { source: 'src/browser/detail/index.ts', output: 'assets/post-map.js' },
  { source: 'src/browser/overview/index.ts', output: 'assets/overview-map.js' },
  { source: 'src/browser/styles/index.css', output: 'assets/style.css' },
  { source: 'src/browser/author/index.ts', output: 'author/editor.js' },
  { source: 'src/browser/author/style.css', output: 'author/editor.css' },
];
const forbiddenRuntimeInputs = [
  'src/browser/providers/',
  'src/browser/detail/',
  'src/browser/overview/',
  'src/templates/',
  'src/domain/',
  'src/presentation/',
  'src/author/',
  'src/browser/author/',
];

await rm(distDirectory, { force: true, recursive: true });
await mkdir(resolve(distDirectory, 'assets'), { recursive: true });
await mkdir(resolve(distDirectory, 'author'), { recursive: true });
await copyFile(
  resolve(projectRoot, 'src/author/editor.html'),
  resolve(distDirectory, 'author/editor.html'),
);
await copyFile(
  resolve(projectRoot, 'src/browser/styles/placeholder.svg'),
  resolve(distDirectory, 'assets/placeholder.svg'),
);

await build({
  bundle: true,
  entryPoints: [resolve(projectRoot, 'src/index.ts')],
  external: ['hexo', './author/server.cjs'],
  format: 'cjs',
  legalComments: 'eof',
  outfile: resolve(distDirectory, 'index.cjs'),
  platform: 'node',
  sourcemap: false,
  target: 'node20',
});

await build({
  absWorkingDir: projectRoot,
  bundle: true,
  entryPoints: [resolve(projectRoot, 'src/author/entry.ts')],
  format: 'cjs',
  legalComments: 'eof',
  outfile: resolve(distDirectory, 'author/server.cjs'),
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

  const result = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    entryPoints: [source],
    format: 'iife',
    legalComments: 'eof',
    outfile: resolve(distDirectory, entry.output),
    platform: 'browser',
    minify: true,
    metafile: true,
    sourcemap: false,
    target: 'es2020',
  });
  if (entry.output.startsWith('assets/')) {
    for (const input of Object.keys(result.metafile.inputs)) {
      const sourcePath = relative(projectRoot, resolve(projectRoot, input)).replaceAll('\\', '/');
      if (/src\/(?:author|browser\/author)\/|node_modules\/yaml\//u.test(sourcePath)) {
        throw new Error(`[hexo-post-map] Reader entry imports forbidden source: ${sourcePath}`);
      }
    }
  }
  if (entry.lightweight) {
    for (const input of Object.keys(result.metafile.inputs)) {
      const sourcePath = relative(projectRoot, resolve(projectRoot, input)).replaceAll('\\', '/');
      if (forbiddenRuntimeInputs.some((prefix) => sourcePath.startsWith(prefix))) {
        throw new Error(`[hexo-post-map] Runtime entry imports forbidden source: ${sourcePath}`);
      }
    }
    const size = (await stat(resolve(distDirectory, entry.output))).size;
    if (size > 8192) {
      throw new Error(`[hexo-post-map] Runtime entry exceeds 8192 bytes: ${size}`);
    }
  }
}
