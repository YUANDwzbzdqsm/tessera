// Rebuilds the SSE patch animation and all six episodes. Each build checks its own references and stops on the first error.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
for (const dir of ['sse-anim', 'ep1', 'ep2', 'ep3', 'ep4', 'ep5', 'ep6']) {
  console.log(`\n== ${dir}`);
  execFileSync(process.execPath, ['build.mjs'], { cwd: join(here, dir), stdio: 'inherit' });
}
