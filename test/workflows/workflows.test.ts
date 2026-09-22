import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

interface Step {
  uses?: string;
  run?: string;
  id?: string;
  if?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  'runs-on': string;
  permissions?: Record<string, string>;
  environment?: string;
  strategy?: { matrix: Record<string, unknown[]> };
  steps: Step[];
}
interface Workflow {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
}
function workflow(name: string): Workflow {
  const path = `.github/workflows/${name}.yml`;
  expect(existsSync(path), `${name} workflow must exist`).toBe(true);
  return parse(readFileSync(path, 'utf8')) as Workflow;
}
function action(job: Job, name: string) {
  return job.steps.find((step) => step.uses?.startsWith(`${name}@`));
}
function runIndex(job: Job, command: string) {
  const index = job.steps.findIndex((step) => step.run === command);
  expect(index, `Missing required command: ${command}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe('GitHub workflow publication and compatibility boundaries', () => {
  it('runs separate checks, every supported Node/Hexo pair, and Chromium for PRs and pushes', () => {
    const ci = workflow('ci');
    expect(Object.keys(ci.on).sort()).toEqual(['pull_request', 'push']);
    expect(ci.permissions).toEqual({ contents: 'read' });
    const { checks, integration, browser } = ci.jobs;
    expect(checks && integration && browser).toBeTruthy();
    runIndex(checks!, 'npm run check');
    expect(integration!.strategy!.matrix).toEqual({
      node: [20, 22, 24],
      hexo: ['7.1.1', '7.3.0', '8.1.2'],
    });
    expect(action(integration!, 'actions/setup-node')?.with?.['node-version']).toBe(
      '${{ matrix.node }}',
    );
    const matrixCommand = integration!.steps.find((step) => step.env?.HEXO_VERSION);
    expect(matrixCommand?.env?.HEXO_VERSION).toBe('${{ matrix.hexo }}');
    expect(matrixCommand?.run).toBe('npm run test:integration -- --hexo="$HEXO_VERSION"');
    runIndex(browser!, 'npx playwright install --with-deps chromium');
    runIndex(browser!, 'npm run test:e2e -- --trace=retain-on-failure');
    for (const job of Object.values(ci.jobs)) {
      expect(action(job, 'actions/setup-node')?.with?.cache).toBe('npm');
      expect(action(job, 'actions/cache')).toBeUndefined();
      runIndex(job, 'npm ci');
      for (const step of job.steps.filter((step) =>
        step.uses?.startsWith('actions/upload-artifact@'),
      )) {
        expect(step.if).toBe('failure()');
        expect(step.with?.path).toBe('test-results/**/trace.zip');
      }
    }
    expect(action(browser!, 'actions/upload-artifact')).toBeDefined();
  });

  it('publishes only tagged GitHub Releases with OIDC, clean builds, and exact verified bytes', () => {
    const publish = workflow('publish');
    expect(publish.on).toEqual({ release: { types: ['published'] } });
    expect(publish.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    expect(Object.keys(publish.jobs)).toEqual(['publish']);
    const job = publish.jobs.publish!;
    expect(job['runs-on']).toBe('ubuntu-latest');
    expect(job.environment).toBe('npm');
    expect(action(job, 'actions/checkout')?.with).toMatchObject({
      ref: '${{ github.event.release.tag_name }}',
      'persist-credentials': false,
    });
    expect(action(job, 'actions/setup-node')?.with).toMatchObject({
      'node-version': 24,
      'registry-url': 'https://registry.npmjs.org',
      'package-manager-cache': false,
    });
    expect(action(job, 'actions/setup-node')?.with?.cache).toBeUndefined();
    expect(action(job, 'actions/cache')).toBeUndefined();
    expect(JSON.stringify(publish)).not.toContain('NPM_TOKEN');
    expect(JSON.stringify(publish)).not.toContain('NODE_AUTH_TOKEN');
    const updateNpm = runIndex(job, 'npm install --global npm@latest');
    const install = runIndex(job, 'npm ci');
    const checks = runIndex(job, 'npm run check');
    const pack = job.steps.findIndex((step) => step.id === 'pack');
    const integration = runIndex(job, 'npm run test:integration');
    const browser = runIndex(job, 'npm run test:e2e -- --trace=retain-on-failure');
    const publishIndex = runIndex(
      job,
      'npm publish "$HPM_PACKED_TARBALL" --access public --provenance --ignore-scripts',
    );
    expect(updateNpm).toBeLessThan(install);
    expect(install).toBeLessThan(checks);
    expect(checks).toBeLessThan(pack);
    expect(pack).toBeLessThan(integration);
    expect(integration).toBeLessThan(browser);
    expect(browser).toBeLessThan(publishIndex);
    for (const index of [integration, browser, publishIndex]) {
      expect(job.steps[index]?.env?.HPM_PACKED_TARBALL).toBe('${{ steps.pack.outputs.tarball }}');
      expect(job.steps[index]?.if).toBeUndefined();
    }
    expect(job.steps.some((step) => step.id === 'verify-artifact')).toBe(true);
    expect(job.steps.findIndex((step) => step.id === 'verify-artifact')).toBeLessThan(publishIndex);
    expect(job.steps.findIndex((step) => step.id === 'verify-artifact')).toBeGreaterThan(browser);
    expect(job.steps.find((step) => step.id === 'verify-artifact')?.env).toMatchObject({
      HPM_PACKED_TARBALL: '${{ steps.pack.outputs.tarball }}',
      HPM_PACKED_SHA256: '${{ steps.pack.outputs.sha256 }}',
    });
  });

  it('uses an App token to let Release Please trigger CI and release publication without publishing itself', () => {
    const release = workflow('release-please');
    expect(release.on).toEqual({ push: { branches: ['main'] } });
    const job = release.jobs['release-please']!;
    const token = action(job, 'actions/create-github-app-token');
    expect(token?.id).toBe('app-token');
    expect(token?.with).toMatchObject({
      'app-id': '${{ vars.RELEASE_APP_ID }}',
      'private-key': '${{ secrets.RELEASE_APP_PRIVATE_KEY }}',
    });
    expect(action(job, 'googleapis/release-please-action')?.with).toMatchObject({
      token: '${{ steps.app-token.outputs.token }}',
      'config-file': 'release-please-config.json',
      'manifest-file': '.release-please-manifest.json',
    });
    expect(job.steps.every((step) => !step.run)).toBe(true);
    const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'));
    expect(config.packages['.']).toMatchObject({
      'release-type': 'node',
      'package-name': 'hexo-post-map',
      'initial-version': '0.1.0',
      'changelog-path': 'CHANGELOG.md',
      'include-component-in-tag': false,
    });
    expect(config.packages['.']['release-as']).toBeUndefined();
    const manifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'));
    // Initially empty; Release Please records versions here after the first release.
    for (const [path, version] of Object.entries(manifest)) {
      expect(path).toBe('.');
      expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u);
    }
  });

  it('groups weekly npm and GitHub Actions dependency updates', () => {
    expect(existsSync('.github/dependabot.yml')).toBe(true);
    const dependabot = parse(readFileSync('.github/dependabot.yml', 'utf8'));
    expect(dependabot.version).toBe(2);
    expect(
      dependabot.updates.map((entry: Record<string, unknown>) => entry['package-ecosystem']).sort(),
    ).toEqual(['github-actions', 'npm']);
    for (const update of dependabot.updates) {
      expect(update.directory).toBe('/');
      expect(update.schedule.interval).toBe('weekly');
      expect(Object.values(update.groups)).toEqual([{ patterns: ['*'] }]);
    }
  });

  it('executes the artifact gate and rejects bytes changed after packing', () => {
    const job = workflow('publish').jobs.publish!;
    const pack = job.steps.find((step) => step.id === 'pack')!;
    const verify = job.steps.find((step) => step.id === 'verify-artifact')!;
    const directory = mkdtempSync(join(tmpdir(), 'hpm-publish-gate-'));
    try {
      const project = join(directory, 'project');
      mkdirSync(join(project, 'dist'), { recursive: true });
      writeFileSync(
        join(project, 'package.json'),
        JSON.stringify({ name: 'hexo-post-map', version: '0.1.0', files: ['dist'] }),
      );
      writeFileSync(join(project, 'dist/index.cjs'), 'module.exports = {};');
      mkdirSync(join(project, 'scripts'));
      copyFileSync('scripts/npm-pack-json.mjs', join(project, 'scripts/npm-pack-json.mjs'));
      const output = join(directory, 'output');
      execFileSync('bash', ['-e', '-o', 'pipefail', '-c', pack.run!], {
        cwd: project,
        env: { ...process.env, RUNNER_TEMP: directory, GITHUB_OUTPUT: output },
        stdio: 'pipe',
      });
      const values = Object.fromEntries(
        readFileSync(output, 'utf8')
          .trim()
          .split('\n')
          .map((line) => {
            const separator = line.indexOf('=');
            return [line.slice(0, separator), line.slice(separator + 1)];
          }),
      );
      const tarball = values.tarball!;
      expect(tarball).toBe(join(directory, 'hexo-post-map-0.1.0.tgz'));
      expect(values.sha256).toBe(createHash('sha256').update(readFileSync(tarball)).digest('hex'));
      const verifyArtifact = () =>
        execFileSync('bash', ['-e', '-o', 'pipefail', '-c', verify.run!], {
          env: { ...process.env, HPM_PACKED_TARBALL: tarball, HPM_PACKED_SHA256: values.sha256 },
          stdio: 'pipe',
        });
      expect(verifyArtifact).not.toThrow();
      appendFileSync(tarball, 'changed after verification');
      expect(verifyArtifact).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
