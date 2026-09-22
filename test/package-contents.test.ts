import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { normalizeNpmPackJson } from '../scripts/npm-pack-json.mjs';

it('publishes only compiled assets, readmes, license, and package metadata', () => {
  const packages = normalizeNpmPackJson(
    JSON.parse(
      execFileSync('npm', ['pack', '--json', '--dry-run', '--ignore-scripts'], {
        encoding: 'utf8',
      }),
    ),
  );
  expect(packages).toHaveLength(1);
  const files = packages.flatMap((entry) => entry.files.map((file) => file.path));
  const allowed = new Set(['README.md', 'README.zh-CN.md', 'LICENSE', 'package.json']);
  expect(files.length).toBeGreaterThanOrEqual(4);
  expect(files.filter((file) => !file.startsWith('dist/') && !allowed.has(file))).toEqual([]);
  expect(files.filter((file) => file.endsWith('.map'))).toEqual([]);
  expect(files).toEqual(expect.arrayContaining([...allowed]));
}, 15_000);
