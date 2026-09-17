import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';

it('fails on a missing explicitly supplied tarball instead of silently repacking the source', () => {
  const missing = join(tmpdir(), `hpm-missing-${randomUUID()}.tgz`);
  const result = spawnSync(
    process.execPath,
    [
      'test/integration/pack-and-build.mjs',
      '--hexo=8.1.2',
      '--theme=cactus-minimal',
      '--root=/blog/',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, HPM_PACKED_TARBALL: missing, npm_config_offline: 'true' },
      timeout: 20_000,
    },
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(missing);
  expect(result.stdout).not.toContain('PASS Hexo');
}, 25_000);
