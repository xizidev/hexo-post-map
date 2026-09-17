import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTemporaryWorkspace } from './runner-lifecycle.mjs';

const [control, phase] = process.argv.slice(2);
await withTemporaryWorkspace(async ({ temporary, run }) => {
  await writeFile(join(control, 'workspace.json'), JSON.stringify({ temporary }));
  await writeFile(join(temporary, 'fixture.tgz'), 'tarball sentinel');
  if (phase === 'generate') await run(process.execPath, ['-e', ''], temporary, process.env);
  await run(
    process.execPath,
    [fileURLToPath(new URL('./cancellation-worker.mjs', import.meta.url)), control, temporary],
    temporary,
    process.env,
  );
  await writeFile(join(control, 'next-stage'), 'must not run after cancellation');
});
