import 'ses';
import { defineCatalog } from '@tessera/catalog';
import { compile } from '@tessera/lang';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCompartment, createSafe, createUi, evaluateProgram, instantiate, loadProgram, type Endowments } from '../src/program';
import type { Action, RuntimeIssue } from '../src/protocol';

beforeAll(() => {
  // Same options as the worker entry.
  lockdown({ errorTaming: 'unsafe', consoleTaming: 'unsafe', overrideTaming: 'severe' });
});

interface El {
  type: string;
  props: Record<string, unknown>;
  children: unknown[];
}
const FRAGMENT = Symbol('Fragment');

function setup() {
  const issues: RuntimeIssue[] = [];
  const actions: Action[] = [];
  let changes = 0;
  const safe = createSafe((i) => issues.push(i));
  const ui = createUi({
    store: new Map(),
    safe,
    onChange: () => changes++,
    onAction: (a) => actions.push(a),
    isElement: (v) => typeof v === 'object' && v !== null && 'type' in v,
  });
  const h = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): El | unknown[] =>
    type === FRAGMENT ? children.flat(Infinity) : { type: type as string, props: props ?? {}, children: children.flat(Infinity) };
  const endowments: Endowments = { h, Fragment: FRAGMENT, ui, safe };
  return { endowments, issues, actions, changes: () => changes };
}

const text = (n: unknown): string =>
  n === null || n === undefined ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : text((n as El).children);

const find = (n: unknown, type: string): El | undefined => {
  if (Array.isArray(n)) {
    for (const c of n) {
      const hit = find(c, type);
      if (hit) return hit;
    }
    return undefined;
  }
  if (typeof n !== 'object' || n === null) return undefined;
  const el = n as El;
  return el.type === type ? el : find(el.children, type);
};

describe('compiled programs under SES', () => {
  const catalog = defineCatalog();

  it('run in a compartment and keep state across re-renders and new programs', () => {
    const { endowments, actions, changes } = setup();
    const v1 = compile('{@state seats = 8}\n{@let price = seats * 29}\n<Slider min={1} max={50} value={seats} onChange={setSeats} />\n<Title>{price}</Title>\n<Button onClick={() => ui.send(`n=${seats}`)}>go</Button>', { catalog });
    const Root = loadProgram(v1, endowments);
    const first = Root();
    expect(text(find(first, 'Title'))).toBe('232');

    (find(first, 'Slider')!.props.onChange as (v: number) => void)(9);
    expect(changes()).toBe(1);
    expect(text(find(Root(), 'Title'))).toBe('261');

    // A recompiled program (different formula) keeps the keyed state.
    const v2 = compile('{@state seats = 8}\n<Title>{seats * 30}</Title>', { catalog });
    expect(text(find(loadProgram(v2, endowments)(), 'Title'))).toBe('270');

    (find(Root(), 'Button')!.props.onClick as () => void)();
    expect(actions).toEqual([{ type: 'send', text: 'n=9' }]);
  });
});

describe('the compartment boundary', () => {
  // These programs bypass the compiler on purpose: the sandbox must hold even if the guard is wrong.
  const run = (body: string) => {
    const { endowments, issues } = setup();
    const code = `(function (__h, __F, __ui, __C, __safe) { return function () { ${body} }; })`;
    return { result: loadProgram({ code, constants: [] }, endowments)(), issues };
  };

  it('exposes no host capabilities', () => {
    const { result } = run(
      'return [typeof fetch, typeof setTimeout, typeof postMessage, typeof self, typeof document, typeof process, typeof require].join(",");',
    );
    expect(result).toBe('undefined,undefined,undefined,undefined,undefined,undefined,undefined');
  });

  it("cannot reach the host realm through an endowment's constructor", () => {
    const { result } = run('try { return __h.constructor("return typeof fetch")(); } catch (e) { return "blocked: " + e.name; }');
    expect(result).toMatch(/^blocked|^undefined$/);
  });

  it('evaluates new code only inside the compartment', () => {
    const { result } = run('return Function("return typeof fetch + typeof process")();');
    expect(result).toBe('undefinedundefined');
  });

  it('cannot pollute shared prototypes or mutate endowments', () => {
    expect(run('try { Object.prototype.polluted = 1; return "mutated"; } catch (e) { return e.name; }').result).toBe('TypeError');
    expect(run('try { __ui.api.send = null; return "mutated"; } catch (e) { return e.name; }').result).toBe('TypeError');
    expect(run('try { __C.push("x"); return "mutated"; } catch (e) { return e.name; }').result).toBe('TypeError');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('reports a throwing expression once and keeps rendering', () => {
    const { endowments, issues } = setup();
    const Root = loadProgram(compile('a {JSON.parse("{")} b', { catalog: defineCatalog() }), endowments);
    expect(text(Root())).toBe('a  b');
    expect(issues.map((i) => i.code)).toEqual(['expression_error']);
  });

  it('reuses one compartment and one evaluated factory across constants-only updates', () => {
    const { endowments } = setup();
    const compartment = createCompartment();
    const factory = evaluateProgram(compile('## Hel', { catalog: defineCatalog() }).code, compartment);
    const grown = compile('## Hello', { catalog: defineCatalog() });
    expect(grown.code).toBe(compile('## Hel', { catalog: defineCatalog() }).code);
    expect(text(instantiate(factory, grown.constants, {}, endowments)())).toBe('Hello');
    // A different program in the same compartment still sees no host capabilities.
    const probe = evaluateProgram('(function () { return function () { return typeof fetch; }; })', compartment);
    expect(instantiate(probe, [], {}, endowments)()).toBe('undefined');
  });

  it('rejects code that is not a program', () => {
    const { endowments } = setup();
    expect(() => loadProgram({ code: '42', constants: [] }, endowments)).toThrow(TypeError);
  });
});
