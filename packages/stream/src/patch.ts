import type { PatchOp, StreamDoc } from './protocol';

/** Applies ops without mutating the input; untouched branches are shared, so React can compare by reference. */
export function applyOps(doc: StreamDoc, ops: readonly PatchOp[]): StreamDoc {
  let out: unknown = doc;
  for (const op of ops) out = applyOp(out, op);
  return out as StreamDoc;
}

function applyOp(root: unknown, op: PatchOp): unknown {
  const segments = op.path.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (segments.length === 0) throw new Error(`Invalid patch path: ${op.path}`);
  return setIn(root, segments, op);
}

function setIn(node: unknown, segments: readonly string[], op: PatchOp): unknown {
  const [key, ...rest] = segments as [string, ...string[]];
  if (Array.isArray(node)) {
    const copy = [...node];
    if (rest.length === 0 && key === '-') {
      if (op.op !== 'add') throw new Error(`${op.op} cannot target ${op.path}`);
      copy.push(op.value);
      return copy;
    }
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index > copy.length) throw new Error(`Bad index in ${op.path}`);
    copy[index] = rest.length ? setIn(copy[index], rest, op) : leaf(copy[index], op);
    return copy;
  }
  if (typeof node !== 'object' || node === null) throw new Error(`Path ${op.path} goes through a non-container`);
  const record = node as Record<string, unknown>;
  return { ...record, [key]: rest.length ? setIn(record[key], rest, op) : leaf(record[key], op) };
}

function leaf(current: unknown, op: PatchOp): unknown {
  if (op.op !== 'append') return op.value;
  if (typeof current !== 'string') throw new Error(`append needs a string at ${op.path}`);
  return current + op.value;
}
