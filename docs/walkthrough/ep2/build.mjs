// Builds episode 2 on the v2 player: the real 27-frame capture, before/after code for diff beats and scans.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEpisode, readCapture } from '../series/build-lib.mjs';
import * as script from './script.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const frames = readCapture(join(here, '../sse-anim/capture.txt'));
const batches = frames.map((f) => JSON.parse(f.split('\ndata: ')[1]));

// Replay the code string: every code splice, by frame.
const diffs = {};
let current = '';
for (const b of batches) {
  for (const op of b.ops) {
    if (op.path !== '/code') continue;
    const before = current;
    current = op.op === 'replace' ? op.value : before.slice(0, op.start) + op.value + before.slice(op.start + op.remove);
    if (op.op === 'splice') diffs[b.seq] = { before, after: current, start: op.start, remove: op.remove, value: op.value };
  }
}
// Scans run on the same real strings.
for (const ch of script.chapters) {
  for (const b of ch.beats) {
    const sc = b.board?.scene;
    if (sc?.type !== 'strdiff') continue;
    const d = diffs[sc.frame];
    Object.assign(sc, { prev: d.before, next: d.after, start: d.start, remove: d.remove, insert: d.value.length });
  }
}
buildEpisode({ outFile: join(here, 'tessera-ep2.html'), script, extra: { frames, diffs } });
