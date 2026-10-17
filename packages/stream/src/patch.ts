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
  if (op.op === 'append') {
    if (typeof current !== 'string') throw new Error(`append needs a string at ${op.path}`);
    return current + op.value;
  }
  if (op.op === 'splice') {
    if (typeof current !== 'string') throw new Error(`splice needs a string at ${op.path}`);
    if (op.start < 0 || op.remove < 0 || op.start + op.remove > current.length) throw new Error(`splice out of range at ${op.path}`);
    return current.slice(0, op.start) + op.value + current.slice(op.start + op.remove);
  }
  return op.value;
}

/** Escapes a key for use as one JSON Pointer segment. */
export function pointer(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** The cheaper of a splice (only the changed middle) and a full replace, for turning `prev` into `next`. */
export function stringDiff(path: string, prev: string, next: string): PatchOp {
  const max = Math.min(prev.length, next.length);
  let start = 0;
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && prev.charCodeAt(prev.length - 1 - end) === next.charCodeAt(next.length - 1 - end)) end++;
  const splice: PatchOp = { op: 'splice', path, start, remove: prev.length - start - end, value: next.slice(start, next.length - end) };
  const replace: PatchOp = { op: 'replace', path, value: next };
  return JSON.stringify(splice).length < JSON.stringify(replace).length ? splice : replace;
}
