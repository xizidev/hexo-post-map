import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [control, temporary] = process.argv.slice(2);
const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
});
let stopping = false;
let finished = false;
async function finish() {
  if (finished) return;
  finished = true;
  await writeFile(
    join(control, 'child-exit.json'),
    JSON.stringify({ workspaceStillPresent: existsSync(join(temporary, 'fixture.tgz')) }),
  );
  process.exit(0);
}
descendant.on('exit', () => {
  if (stopping) void finish();
});
process.on('SIGTERM', () => {
  stopping = true;
  if (descendant.exitCode !== null || descendant.signalCode !== null) void finish();
});
await writeFile(
  join(control, 'ready.json'),
  JSON.stringify({ child: process.pid, descendant: descendant.pid }),
);
setInterval(() => {}, 1000);
