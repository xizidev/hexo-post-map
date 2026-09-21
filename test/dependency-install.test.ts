import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

interface LockPackage {
  resolved?: string;
}

interface PackageLock {
  packages: Record<string, LockPackage>;
}

it('keeps release installs on the official npm registry', () => {
  const configuredRegistry = execFileSync('npm', ['config', 'get', 'registry'], {
    encoding: 'utf8',
  }).trim();
  expect(configuredRegistry).toBe('https://registry.npmjs.org/');

  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as PackageLock;
  const nonOfficialPackages = Object.entries(lock.packages)
    .filter(([, entry]) => entry.resolved?.startsWith('http'))
    .filter(([, entry]) => new URL(entry.resolved!).origin !== 'https://registry.npmjs.org')
    .map(([path]) => path);

  expect(nonOfficialPackages).toEqual([]);
});
