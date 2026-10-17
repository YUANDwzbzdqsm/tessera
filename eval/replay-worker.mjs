// Replays one compiled program in a real SES compartment, in its own thread so the parent can kill it on a hang.
// It mirrors what the runtime does (same endowments, same lockdown), without a DOM: `h` builds a plain tree.
// After the first render it fires every event handler once (sliders to their max, checkboxes on, buttons
// clicked) and renders again, to catch errors that only show up on interaction.
import 'ses';
import { parentPort, workerData } from 'node:worker_threads';

lockdown({ errorTaming: 'unsafe', consoleTaming: 'unsafe', overrideTaming: 'severe' });

const { code, constants, data } = workerData;
const FRAGMENT = Symbol('Fragment');
const issues = [];
const actions = [];
const store = new Map();
const setters = new Map();

const report = (kind, error) => issues.push(`${kind}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
const safe = (fn, fallback) => {
  try {
    return fn();
  } catch (e) {
    report('expression_error', e);
    return fallback;
  }
};
const value = (v) => {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (Array.isArray(v)) return v.map(value);
  if (typeof v === 'object' && v && 'type' in v && 'props' in v) return v;
  return safe(() => JSON.stringify(v), String(v));
};
const ui = {
  api: Object.freeze({
    send: (t) => actions.push(['send', String(t)]),
    copy: (t) => actions.push(['copy', String(t)]),
    open: (u) => actions.push(['open', String(u)]),
  }),
  useState(key, init) {
    if (!store.has(key)) store.set(key, init());
    if (!setters.has(key)) {
      setters.set(key, (next) => {
        const prev = store.get(key);
        store.set(key, typeof next === 'function' ? safe(() => next(prev), prev) : next);
      });
    }
    return [store.get(key), setters.get(key)];
  },
  value,
};
const flat = (kids) => kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false);
const h = (type, props, ...kids) => (type === FRAGMENT ? flat(kids) : { type, props: props ?? {}, children: flat(kids) });

function walk(nodes, visit) {
  for (const n of [nodes].flat(Infinity)) {
    if (!n || typeof n !== 'object') continue;
    visit(n);
    walk(n.children, visit);
  }
}
function summarise(tree) {
  let count = 0;
  let text = '';
  const components = new Set();
  walk(tree, (n) => {
    count++;
    components.add(n.type);
  });
  const collect = (nodes) => {
    for (const n of [nodes].flat(Infinity)) {
      if (typeof n === 'string') text += n;
      else if (n && typeof n === 'object') collect(n.children);
    }
  };
  collect(tree);
  return { nodes: count, components: [...components].sort(), text: text.slice(0, 600) };
}

try {
  const compartment = new Compartment({ __options__: true, name: 'tessera-eval' });
  const factory = compartment.evaluate(code);
  const Root = factory(harden(h), FRAGMENT, harden(ui), harden([...constants]), harden(safe), harden(structuredClone(data ?? {})));
  const first = Root();
  const before = summarise(first);

  let fired = 0;
  walk(first, (n) => {
    const p = n.props;
    try {
      if (typeof p.onChange === 'function') {
        p.onChange(n.type === 'Slider' ? (typeof p.max === 'number' ? p.max : 1) : true);
        fired++;
      }
      if (typeof p.onClick === 'function') {
        p.onClick();
        fired++;
      }
    } catch (e) {
      report('handler_error', e);
    }
  });
  const after = summarise(Root());
  parentPort.postMessage({ ok: true, issues, actions: actions.length, fired, before, after, state: Object.fromEntries([...store].map(([k, v]) => [k, safe(() => JSON.parse(JSON.stringify(v)), null)])) });
} catch (e) {
  parentPort.postMessage({ ok: false, issues, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
}
