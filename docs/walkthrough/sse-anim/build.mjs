// Builds the SSE patch animation: replays a real captured stream, records the document after every frame,
// and runs each version of the compiled program (with a stub renderer) to get what the screen shows.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, 'capture.txt'), 'utf8');
const frames = raw
  .split('\n\n')
  .filter((f) => f.trim())
  .map((f) => ({ raw: f, batch: JSON.parse(f.split('\ndata: ')[1]) }));

// Same semantics as packages/stream/src/patch.ts.
function applyOps(doc, ops) {
  const next = structuredClone(doc);
  for (const op of ops) {
    const parts = op.path.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    const key = parts.pop();
    let target = next;
    for (const p of parts) target = target[p];
    if (op.op === 'append') target[key] += op.value;
    else if (op.op === 'splice') target[key] = target[key].slice(0, op.start) + op.value + target[key].slice(op.start + op.remove);
    else if (op.op === 'replace') target[key] = op.value;
    else if (op.op === 'add') {
      if (Array.isArray(target) && key === '-') target.push(op.value);
      else target[key] = op.value;
    }
  }
  return next;
}

function render(doc) {
  if (!doc.code) return [];
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) });
  const store = new Map();
  const ui = {
    api: { send() {}, copy() {}, open() {} },
    useState: (k, init) => {
      if (!store.has(k)) store.set(k, init());
      return [store.get(k), () => {}];
    },
    value: (v) => (v == null || typeof v === 'boolean' ? null : typeof v === 'object' && !Array.isArray(v) && !v.type ? JSON.stringify(v) : typeof v === 'object' ? v : String(v)),
  };
  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  const factory = new Function(`return ${doc.code}`)();
  const tree = factory(h, 'Fragment', ui, doc.constants, safe, doc.data)();
  const clean = (n) => {
    if (n == null || n === false) return [];
    if (typeof n === 'string' || typeof n === 'number') return [String(n)];
    if (Array.isArray(n)) return n.flatMap(clean);
    if (n.type === 'Fragment') return n.children.flatMap(clean);
    const props = {};
    for (const [k, v] of Object.entries(n.props)) props[k] = typeof v === 'function' ? true : v;
    return [{ type: n.type, props, children: n.children.flatMap(clean) }];
  };
  return clean(tree);
}

let doc = { text: '', code: '', constants: [], data: {}, diagnostics: [], done: false };
const steps = frames.map(({ raw, batch }) => {
  const before = doc;
  doc = applyOps(doc, batch.ops);
  return { raw, bytes: Buffer.byteLength(raw) + 2, batch, before, after: doc, screen: render(doc) };
});

const source = '## 你好，这是一个会动的界面\n{@state n = 3}\n<Slider min={1} max={9} value={n} onChange={setN} label="选一个数" />\n现在是 **{n}**\n<Image query="小熊猫" aspect="16:9" />';
if (doc.text !== source) throw new Error('replayed text does not match the source');
if (!doc.done) throw new Error('stream did not finish');
console.log(`${steps.length} frames, ${steps.reduce((a, s) => a + s.batch.ops.length, 0)} ops; final screen:`, JSON.stringify(steps.at(-1).screen).slice(0, 300));

const data = JSON.stringify({ steps: steps.map(({ raw, bytes, batch, screen }) => ({ raw, bytes, batch, screen })) }).replace(/</g, '\\u003c');
writeFileSync(join(here, 'sse-patches.html'), readFileSync(join(here, 'template.html'), 'utf8').replace('/*__DATA__*/null', data));
console.log('wrote sse-patches.html');
