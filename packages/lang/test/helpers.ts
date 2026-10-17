import type { CompiledProgram } from '../src/index';

export interface FakeNode {
  type: string;
  props: Record<string, unknown>;
  children: (FakeNode | string)[];
}

const FRAGMENT = Symbol('Fragment');

/**
 * Runs a compiled program outside any sandbox with a fake `h`, flattening fragments.
 * Good enough to check what a program renders; the SES path is tested separately.
 */
export function render(program: CompiledProgram, state = new Map<string, unknown>()) {
  const sent: string[] = [];
  const errors: unknown[] = [];
  const h = (type: string | symbol, props: Record<string, unknown> | null, ...kids: unknown[]): FakeNode | FakeNode[] => {
    const children = flatten(kids);
    if (type === FRAGMENT) return children as FakeNode[];
    return { type: type as string, props: props ?? {}, children };
  };
  const ui = {
    api: { send: (t: string) => sent.push(t), copy() {}, open() {} },
    useState(key: string, init: () => unknown) {
      if (!state.has(key)) state.set(key, init());
      return [state.get(key), (v: unknown) => state.set(key, v)];
    },
    value: (v: unknown) => (v === null || v === undefined || typeof v === 'boolean' ? null : typeof v === 'object' ? v : String(v)),
  };
  const safe = (fn: () => unknown, fallback: unknown) => {
    try {
      return fn();
    } catch (e) {
      errors.push(e);
      return fallback;
    }
  };
  const factory = new Function(`return ${program.code}`)();
  const Root = factory(h, FRAGMENT, ui, program.constants, safe);
  const tree = Root() as FakeNode[];
  return { tree, state, sent, errors };
}

function flatten(kids: unknown[]): (FakeNode | string)[] {
  const out: (FakeNode | string)[] = [];
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) out.push(...flatten(k));
    else out.push(k as FakeNode | string);
  }
  return out;
}

/** Concatenated text of a subtree. */
export function text(node: FakeNode | string | (FakeNode | string)[]): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(text).join('');
  return node.children.map(text).join('');
}

/** Depth-first search for the first node of a type. */
export function find(nodes: (FakeNode | string)[], type: string): FakeNode | undefined {
  for (const n of nodes) {
    if (typeof n === 'string') continue;
    if (n.type === type) return n;
    const hit = find(n.children, type);
    if (hit) return hit;
  }
  return undefined;
}
