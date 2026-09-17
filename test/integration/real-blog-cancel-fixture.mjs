import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBlogCopy } from './real-blog-smoke.mjs';

const [source, control] = process.argv.slice(2);
await withBlogCopy(source, async ({ temporary, run }) => {
  await writeFile(join(control, 'workspace.json'), JSON.stringify({ temporary }));
  await writeFile(join(temporary, 'fixture.tgz'), 'workspace lifetime sentinel');
  await run(
    process.execPath,
    [fileURLToPath(new URL('./cancellation-worker.mjs', import.meta.url)), control, temporary],
    temporary,
    process.env,
  );
  await writeFile(join(control, 'next-stage'), 'must not run after cancellation');
});
