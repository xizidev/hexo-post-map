import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export async function withTemporaryWorkspace(work) {
  const active = new Set();
  let signal;
  let temporary;
  let notifyCancellation;
  const cancelled = new Promise((resolve) => {
    notifyCancellation = resolve;
  });
  class Cancelled extends Error {}
  const checkpoint = () => {
    if (signal) throw new Cancelled('Packed runner cancelled');
  };
  function kill(record, hard = false) {
    if (!record.child.pid) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(record.child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      killer.on('error', () => record.child.kill('SIGKILL'));
    } else {
      try {
        process.kill(-record.child.pid, hard ? 'SIGKILL' : 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
  function stop(record) {
    if (record.stopping) return;
    record.stopping = true;
    kill(record);
    record.timer = setTimeout(() => kill(record, true), 2_000);
    record.timer.unref();
  }
  function cancel(received) {
    if (signal) return;
    signal = received;
    for (const record of active) stop(record);
    notifyCancellation();
  }
  const interrupt = () => cancel('SIGINT');
  const terminate = () => cancel('SIGTERM');
  // Install before creating the workspace or starting pack/install/generate/test.
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  async function run(command, args, cwd, env) {
    checkpoint();
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const record = { child, stopping: false, timer: undefined, closed: undefined };
    let failure;
    let output = '';
    let stdout = '';
    record.closed = new Promise((resolve) => {
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.on('error', (error) => {
        failure = error;
      });
      child.on('close', (code) => {
        clearTimeout(record.timer);
        // A group leader can exit while descendants remain; never leave them behind.
        if (record.stopping && process.platform !== 'win32') kill(record, true);
        active.delete(record);
        resolve({ code, output, stdout });
      });
    });
    active.add(record);
    const result = await record.closed;
    checkpoint();
    if (failure) throw failure;
    return result;
  }
  try {
    temporary = await mkdtemp(join(tmpdir(), 'hpm-packed-'));
    assert.ok(dirname(temporary) === tmpdir() && basename(temporary).startsWith('hpm-packed-'));
    checkpoint();
    const result = await work({
      temporary,
      run,
      waitForCancellation: async () => {
        await cancelled;
        checkpoint();
      },
    });
    checkpoint();
    return result;
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
  } finally {
    try {
      const pending = [...active];
      pending.forEach(stop);
      await Promise.all(pending.map((record) => record.closed));
      if (temporary) {
        assert.ok(dirname(temporary) === tmpdir() && basename(temporary).startsWith('hpm-packed-'));
        await rm(temporary, { recursive: true, force: true });
      }
    } finally {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
      if (signal) process.exitCode = signal === 'SIGINT' ? 130 : 143;
    }
  }
}
