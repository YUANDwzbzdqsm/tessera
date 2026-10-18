// Builds episode 3 on the v2 player. The buffer, document and sharing views come from the repo's real SSEParser and
// applyOps (loaded through Vite) run on the real 27-frame capture.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEpisode, openRepo, readCapture } from '../series/build-lib.mjs';
import * as script from './script.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const vite = await openRepo();
const { SSEParser } = await vite.ssrLoadModule('/packages/stream/src/sse.ts');
const { applyOps } = await vite.ssrLoadModule('/packages/stream/src/patch.ts');
const { emptyDoc } = await vite.ssrLoadModule('/packages/stream/src/protocol.ts');

const frames = readCapture(join(here, '../sse-anim/capture.txt'));
const batches = frames.map((f) => JSON.parse(f.split('\ndata: ')[1]));

// Buffer demo: frames 0–2 arriving in two chunks that do not line up with messages.
const wire = frames.slice(0, 3).map((f) => f + '\n\n');
const cut = Math.floor(wire[1].length * 0.45);
const chunks = [wire[0] + wire[1].slice(0, cut), wire[1].slice(cut) + wire[2]];
const parser = new SSEParser();
let pending = '';
const buffer = chunks.map((chunk) => {
  const before = pending;
  const events = parser.push(chunk).map(({ event }) => ({ seq: event.batch.seq, kind: event.batch.kind }));
  const all = before + chunk;
  pending = all.slice(all.lastIndexOf('\n\n') + 2);
  return { before, chunk, bytes: Buffer.byteLength(chunk), events, after: pending };
});
if (buffer[0].events.length !== 1 || buffer[1].events.length !== 2 || pending !== '') throw new Error('buffer demo did not split as expected');

// Which fields are new objects after a frame, with the real applyOps.
const short = (v, n = 44) => {
  let s = typeof v === 'string' ? v : JSON.stringify(v);
  s = s.replace(/data:image\/[^"]{20,}/g, 'data:image/svg…').replace(/\n/g, '↵');
  return s.length > n ? s.slice(0, n) + '…' : s;
};
const FIELDS = ['text', 'code', 'constants', 'data', 'diagnostics', 'done'];
const docs = {};
let doc = emptyDoc;
for (const b of batches) {
  const next = applyOps(doc, b.ops);
  const fields = FIELDS.map((name) => ({
    name,
    same: next[name] === doc[name],
    preview: name === 'text' ? '…' + short(next.text.slice(-24)) : name === 'code' ? `${next.code.length} 个字符` : short(next[name]),
  }));
  docs[b.seq] = { kind: b.kind, ops: b.ops.map((o) => `${o.op} ${o.path} ${short(o.value ?? '', 20)}`), fields, rebuild: !(next.code === doc.code && next.constants === doc.constants && next.data === doc.data) };
  doc = next;
}
await vite.close();
if (docs[4].rebuild || !docs[2].rebuild) throw new Error('frame 4 should not rebuild the program and frame 2 should');

for (const ch of script.chapters) {
  for (const b of ch.beats) {
    const sc = b.board?.scene;
    if (sc?.type === 'share') sc.fields = docs[sc.frame].fields.map((f) => ({ name: f.name, changed: !f.same }));
  }
}
buildEpisode({ outFile: join(here, 'tessera-ep3.html'), script, extra: { frames, buffer, docs } });
