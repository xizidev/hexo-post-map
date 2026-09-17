import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(process.platform === 'win32')(
  'packed runner cancellation lifecycle (POSIX)',
  () => {
    it.each(['install', 'generate'])(
      'awaits the %s process group before deleting its tarball/workspace',
      async (phase) => {
        const control = await mkdtemp(join(tmpdir(), 'hpm-cancel-proof-'));
        const runner = spawn(
          process.execPath,
          [resolve('test/integration/cancellation-fixture.mjs'), control, phase],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        const exited = new Promise((done) =>
          runner.once('close', (code, signal) => done({ code, signal })),
        );
        let temporary: string | undefined;
        let members: { child: number; descendant: number } | undefined;
        try {
          await vi.waitFor(
            async () => {
              members = JSON.parse(await readFile(join(control, 'ready.json'), 'utf8'));
            },
            { timeout: 10_000, interval: 25 },
          );
          ({ temporary } = JSON.parse(await readFile(join(control, 'workspace.json'), 'utf8')));
          expect(existsSync(join(temporary!, 'fixture.tgz'))).toBe(true);
          runner.kill('SIGTERM');
          await expect(exited).resolves.toEqual({ code: 143, signal: null });
          expect(
            JSON.parse(await readFile(join(control, 'child-exit.json'), 'utf8'))
              .workspaceStillPresent,
          ).toBe(true);
          expect(existsSync(temporary!)).toBe(false);
          expect(existsSync(join(control, 'next-stage'))).toBe(false);
          await vi.waitFor(
            () => {
              expect(alive(members!.child)).toBe(false);
              expect(alive(members!.descendant)).toBe(false);
            },
            { timeout: 2_000, interval: 25 },
          );
        } finally {
          if (members && alive(members.child)) process.kill(-members.child, 'SIGKILL');
          if (runner.exitCode === null && runner.signalCode === null) runner.kill('SIGKILL');
          await exited;
          if (temporary) {
            expect(dirname(temporary)).toBe(tmpdir());
            expect(basename(temporary)).toMatch(/^hpm-packed-/u);
            await rm(temporary, { recursive: true, force: true });
          }
          await rm(control, { recursive: true, force: true });
        }
      },
      15_000,
    );
  },
);
