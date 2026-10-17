import { parseExpressionAt } from 'acorn';

/**
 * A small interpreter for the pure subset of expressions, used to render the Markdown fallback with real values.
 * It never runs model code natively: every node costs fuel, collections and strings are capped, and only a fixed
 * list of side-effect-free built-ins can be called. Anything else throws `Unsupported`, and the caller shows a
 * placeholder instead.
 */

type N = { type: string; [key: string]: any };

export class Unsupported extends Error {}

const MAX_ITEMS = 10_000;
const MAX_STRING = 100_000;
const BLOCKED = new Set(['constructor', '__proto__', 'prototype', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);

interface Closure {
  readonly kind: typeof CLOSURE;
  readonly params: readonly N[];
  readonly body: N;
  readonly scope: Scope;
}
interface MethodRef {
  readonly kind: typeof METHOD;
  readonly target: unknown;
  readonly name: string;
}
const CLOSURE = Symbol('closure');
const METHOD = Symbol('method');
const SHORT = Symbol('optional-chain-short-circuit');
/** Stands in for functions the fallback never needs to call for real, such as state setters and ui actions. */
export const NOOP = Object.freeze({ kind: Symbol('noop') });

const MATH = Object.freeze({ namespace: 'Math' });
const NUMBER = Object.freeze({ namespace: 'Number' });
const OBJECT = Object.freeze({ namespace: 'Object' });
const ARRAY = Object.freeze({ namespace: 'Array' });
const JSON_NS = Object.freeze({ namespace: 'JSON' });
const STRING = Object.freeze({ namespace: 'String' });
const UI = Object.freeze({ namespace: 'ui' });

const GLOBALS: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ['Math', MATH],
  ['Number', NUMBER],
  ['Object', OBJECT],
  ['Array', ARRAY],
  ['JSON', JSON_NS],
  ['String', STRING],
  ['Boolean', Object.freeze({ namespace: 'Boolean' })],
  ['ui', UI],
  ['undefined', undefined],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['isNaN', Object.freeze({ fn: 'isNaN' })],
  ['isFinite', Object.freeze({ fn: 'isFinite' })],
  ['parseInt', Object.freeze({ fn: 'parseInt' })],
  ['parseFloat', Object.freeze({ fn: 'parseFloat' })],
]);

export class Scope {
  readonly vars = new Map<string, unknown>();
  constructor(readonly parent?: Scope) {}
  lookup(name: string): unknown {
    for (let s: Scope | undefined = this; s; s = s.parent) if (s.vars.has(name)) return s.vars.get(name);
    if (GLOBALS.has(name)) return GLOBALS.get(name);
    throw new Unsupported(`Unknown name ${name}`);
  }
  has(name: string): boolean {
    for (let s: Scope | undefined = this; s; s = s.parent) if (s.vars.has(name)) return true;
    return GLOBALS.has(name);
  }
}

export interface Fuel {
  remaining: number;
}

export function evaluate(source: string, scope: Scope, fuel: Fuel = { remaining: 20_000 }): unknown {
  let ast: N;
  try {
    ast = parseExpressionAt(source, 0, { ecmaVersion: 2022 }) as unknown as N;
  } catch {
    throw new Unsupported(`Cannot parse ${source}`);
  }
  if (source.slice(ast.end).trim()) throw new Unsupported('Trailing text');
  const value = run(ast, scope, fuel);
  return value === SHORT ? undefined : value;
}

function run(node: N, scope: Scope, fuel: Fuel): unknown {
  if (--fuel.remaining < 0) throw new Unsupported('Out of fuel');
  switch (node.type) {
    case 'Literal':
      if (node.regex) throw new Unsupported('Regular expressions');
      return node.value;
    case 'Identifier':
      return scope.lookup(node.name);
    case 'TemplateLiteral': {
      let out = '';
      node.quasis.forEach((q: N, i: number) => {
        out += q.value.cooked;
        if (i < node.expressions.length) out += toText(run(node.expressions[i], scope, fuel));
      });
      return capString(out);
    }
    case 'BinaryExpression': {
      const l = plain(run(node.left, scope, fuel));
      const r = plain(run(node.right, scope, fuel));
      return binary(node.operator, l, r);
    }
    case 'LogicalExpression': {
      const l = run(node.left, scope, fuel);
      if (node.operator === '&&') return l ? run(node.right, scope, fuel) : l;
      if (node.operator === '||') return l ? l : run(node.right, scope, fuel);
      return l ?? run(node.right, scope, fuel);
    }
    case 'UnaryExpression': {
      if (node.operator === 'typeof') {
        if (node.argument.type === 'Identifier' && !scope.has(node.argument.name)) return 'undefined';
        const v = run(node.argument, scope, fuel);
        return isCallable(v) ? 'function' : typeof v;
      }
      const v = plain(run(node.argument, scope, fuel));
      switch (node.operator) {
        case '!':
          return !v;
        case '-':
          return -(v as number);
        case '+':
          return +(v as number);
        case 'void':
          return undefined;
        default:
          throw new Unsupported(node.operator);
      }
    }
    case 'ConditionalExpression':
      return run(node.test, scope, fuel) ? run(node.consequent, scope, fuel) : run(node.alternate, scope, fuel);
    case 'ArrayExpression': {
      const out: unknown[] = [];
      for (const el of node.elements) {
        if (!el) out.push(undefined);
        else if (el.type === 'SpreadElement') out.push(...iterable(run(el.argument, scope, fuel)));
        else out.push(run(el, scope, fuel));
      }
      return capArray(out);
    }
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {};
      for (const p of node.properties) {
        if (p.type === 'SpreadElement') {
          const v = run(p.argument, scope, fuel);
          if (v && typeof v === 'object' && !isSpecial(v)) Object.assign(out, v);
          continue;
        }
        if (p.kind !== 'init' || p.method) throw new Unsupported('Accessors and methods');
        const key = p.computed ? String(plain(run(p.key, scope, fuel))) : p.key.type === 'Identifier' ? p.key.name : String(p.key.value);
        if (BLOCKED.has(key)) throw new Unsupported(`Key ${key}`);
        out[key] = run(p.value, scope, fuel);
      }
      return out;
    }
    case 'MemberExpression': {
      const object = run(node.object, scope, fuel);
      if (object === SHORT) return SHORT;
      if (node.optional && (object === null || object === undefined)) return SHORT;
      const key = node.computed ? plain(run(node.property, scope, fuel)) : node.property.name;
      return member(object, key as string | number);
    }
    case 'ChainExpression': {
      const v = run(node.expression, scope, fuel);
      return v === SHORT ? undefined : v;
    }
    case 'CallExpression': {
      const callee = run(node.callee, scope, fuel);
      if (callee === SHORT) return SHORT;
      if (node.optional && (callee === null || callee === undefined)) return SHORT;
      const args: unknown[] = [];
      for (const a of node.arguments) {
        if (a.type === 'SpreadElement') args.push(...iterable(run(a.argument, scope, fuel)));
        else args.push(run(a, scope, fuel));
      }
      return call(callee, args, fuel);
    }
    case 'ArrowFunctionExpression':
      if (node.async) throw new Unsupported('async');
      return { kind: CLOSURE, params: node.params, body: node.body, scope } satisfies Closure;
    case 'SequenceExpression': {
      let last: unknown;
      for (const e of node.expressions) last = run(e, scope, fuel);
      return last;
    }
    default:
      throw new Unsupported(node.type);
  }
}

function binary(op: string, l: unknown, r: unknown): unknown {
  const a = l as any;
  const b = r as any;
  switch (op) {
    case '+':
      return typeof a === 'string' || typeof b === 'string' ? capString(String(a) + String(b)) : a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return a / b;
    case '%':
      return a % b;
    case '**':
      return a ** b;
    case '==':
      return a == b;
    case '!=':
      return a != b;
    case '===':
      return a === b;
    case '!==':
      return a !== b;
    case '<':
      return a < b;
    case '>':
      return a > b;
    case '<=':
      return a <= b;
    case '>=':
      return a >= b;
    default:
      throw new Unsupported(op);
  }
}

function member(object: unknown, key: string | number): unknown {
  if (BLOCKED.has(String(key))) throw new Unsupported(`Accessing ${key}`);
  if (object === null || object === undefined) throw new TypeError(`Cannot read ${key} of ${object}`);
  if (object === UI) return NOOP;
  if (isNamespace(object)) {
    if (object === MATH && (key === 'PI' || key === 'E')) return Math[key];
    return { kind: METHOD, target: object, name: String(key) } satisfies MethodRef;
  }
  if (typeof object === 'string' || Array.isArray(object)) {
    if (key === 'length') return object.length;
    if (typeof key === 'number' || /^\d+$/.test(String(key))) return object[Number(key)];
    return { kind: METHOD, target: object, name: String(key) } satisfies MethodRef;
  }
  if (typeof object === 'number') return { kind: METHOD, target: object, name: String(key) } satisfies MethodRef;
  if (typeof object === 'object' && !isSpecial(object)) {
    return Object.prototype.hasOwnProperty.call(object, key) ? (object as Record<string, unknown>)[key] : undefined;
  }
  return undefined;
}

function call(callee: unknown, args: unknown[], fuel: Fuel): unknown {
  if (callee === NOOP) return undefined;
  if (isClosure(callee)) return apply(callee, args, fuel);
  if (callee && typeof callee === 'object' && 'fn' in callee) return globalFunction((callee as { fn: string }).fn, args);
  if (isNamespace(callee)) return namespaceCall(callee, undefined, args);
  if (callee && typeof callee === 'object' && (callee as MethodRef).kind === METHOD) {
    const { target, name } = callee as MethodRef;
    if (isNamespace(target)) return namespaceCall(target, name, args, fuel);
    if (typeof target === 'string') return stringMethod(target, name, args.map(plain));
    if (typeof target === 'number') return numberMethod(target, name, args.map(plain));
    if (Array.isArray(target)) return arrayMethod(target, name, args, fuel);
  }
  throw new Unsupported('Not callable');
}

function apply(fn: Closure, args: unknown[], fuel: Fuel): unknown {
  const scope = new Scope(fn.scope);
  fn.params.forEach((p, i) => {
    if (p.type === 'Identifier') scope.vars.set(p.name, args[i]);
    else if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') scope.vars.set(p.left.name, args[i] === undefined ? run(p.right, scope, fuel) : args[i]);
    else if (p.type === 'RestElement' && p.argument.type === 'Identifier') scope.vars.set(p.argument.name, args.slice(i));
    else throw new Unsupported('Destructuring parameters');
  });
  if (fn.body.type !== 'BlockStatement') return run(fn.body, scope, fuel);
  const result = block(fn.body, scope, fuel);
  return result?.value;
}

function block(node: N, parent: Scope, fuel: Fuel): { value: unknown } | undefined {
  const scope = new Scope(parent);
  for (const statement of node.body) {
    if (--fuel.remaining < 0) throw new Unsupported('Out of fuel');
    switch (statement.type) {
      case 'ReturnStatement':
        return { value: statement.argument ? run(statement.argument, scope, fuel) : undefined };
      case 'ExpressionStatement':
        run(statement.expression, scope, fuel);
        break;
      case 'VariableDeclaration':
        for (const d of statement.declarations) {
          if (d.id.type !== 'Identifier' || statement.kind === 'var') throw new Unsupported('Declaration');
          scope.vars.set(d.id.name, d.init ? run(d.init, scope, fuel) : undefined);
        }
        break;
      case 'IfStatement': {
        const branch = run(statement.test, scope, fuel) ? statement.consequent : statement.alternate;
        if (!branch) break;
        const r = branch.type === 'BlockStatement' ? block(branch, scope, fuel) : block({ type: 'BlockStatement', body: [branch] }, scope, fuel);
        if (r) return r;
        break;
      }
      case 'BlockStatement': {
        const r = block(statement, scope, fuel);
        if (r) return r;
        break;
      }
      case 'EmptyStatement':
        break;
      default:
        throw new Unsupported(statement.type);
    }
  }
  return undefined;
}

function globalFunction(name: string, args: unknown[]): unknown {
  const a = args.map(plain);
  switch (name) {
    case 'isNaN':
      return isNaN(a[0] as number);
    case 'isFinite':
      return isFinite(a[0] as number);
    case 'parseInt':
      return parseInt(String(a[0]), a[1] as number | undefined);
    case 'parseFloat':
      return parseFloat(String(a[0]));
    default:
      throw new Unsupported(name);
  }
}

const MATH_FNS = new Set(['abs', 'round', 'floor', 'ceil', 'min', 'max', 'pow', 'sqrt', 'sign', 'trunc', 'log10', 'log2', 'hypot', 'cbrt']);

function namespaceCall(ns: object, name: string | undefined, args: unknown[], fuel?: Fuel): unknown {
  const a = args.map(plain);
  const label = (ns as { namespace: string }).namespace;
  if (name === undefined) {
    // String(x), Number(x), Boolean(x)
    if (label === 'String') return toText(args[0], true);
    if (label === 'Number') return Number(a[0]);
    if (label === 'Boolean') return Boolean(a[0]);
    throw new Unsupported(`${label}()`);
  }
  if (ns === MATH && MATH_FNS.has(name)) return (Math as any)[name](...a);
  if (ns === NUMBER && ['isFinite', 'isInteger', 'isNaN', 'parseFloat', 'parseInt'].includes(name)) return (Number as any)[name](...a);
  if (ns === OBJECT && ['keys', 'values', 'entries'].includes(name)) {
    const target = args[0];
    if (!target || typeof target !== 'object' || isSpecial(target)) throw new Unsupported(`Object.${name}`);
    return capArray((Object as any)[name](target));
  }
  if (ns === ARRAY && name === 'isArray') return Array.isArray(args[0]);
  if (ns === ARRAY && name === 'from') {
    const [source, mapper] = args;
    let items: unknown[];
    if (source && typeof source === 'object' && !Array.isArray(source) && 'length' in source) {
      const length = Number((source as { length: unknown }).length);
      if (!Number.isInteger(length) || length < 0 || length > MAX_ITEMS) throw new Unsupported('Array.from length');
      items = Array.from({ length }, () => undefined);
    } else {
      items = [...iterable(source)];
    }
    return isClosure(mapper) ? capArray(items.map((v, i) => apply(mapper, [v, i], fuel!))) : capArray(items);
  }
  if (ns === JSON_NS && name === 'stringify') return capString(JSON.stringify(args[0], null, a[2] as number | undefined) ?? '');
  throw new Unsupported(`${label}.${name}`);
}

function stringMethod(s: string, name: string, a: unknown[]): unknown {
  switch (name) {
    case 'toUpperCase':
    case 'toLowerCase':
    case 'trim':
    case 'trimStart':
    case 'trimEnd':
    case 'toString':
      return (s as any)[name]();
    case 'slice':
    case 'substring':
    case 'includes':
    case 'startsWith':
    case 'endsWith':
    case 'indexOf':
    case 'lastIndexOf':
    case 'charAt':
    case 'at':
      return (s as any)[name](...a);
    case 'split':
      if (typeof a[0] !== 'string') throw new Unsupported('split pattern');
      return capArray(s.split(a[0], a[1] as number | undefined));
    case 'replace':
    case 'replaceAll':
      if (typeof a[0] !== 'string' || typeof a[1] !== 'string') throw new Unsupported(`${name} pattern`);
      return capString((s as any)[name](a[0], a[1]));
    case 'padStart':
    case 'padEnd':
    case 'repeat': {
      const size = name === 'repeat' ? s.length * Number(a[0]) : Number(a[0]);
      if (!(size <= MAX_STRING)) throw new Unsupported(`${name} size`);
      return (s as any)[name](...a);
    }
    case 'concat':
      return capString(s.concat(...a.map((x) => String(x))));
    default:
      throw new Unsupported(`string.${name}`);
  }
}

function numberMethod(n: number, name: string, a: unknown[]): unknown {
  if (name === 'toFixed' || name === 'toPrecision' || name === 'toString') return (n as any)[name](...a);
  throw new Unsupported(`number.${name}`);
}

function arrayMethod(list: unknown[], name: string, args: unknown[], fuel: Fuel): unknown {
  const fn = args[0];
  const each = <T>(cb: (value: unknown, index: number) => T): T[] => {
    if (!isClosure(fn)) throw new Unsupported(`${name} without a function`);
    return list.map((v, i) => cb(apply(fn, [v, i, list], fuel), i));
  };
  switch (name) {
    case 'map':
      return capArray(each((r) => r));
    case 'filter': {
      const keep = each((r) => Boolean(r));
      return list.filter((_, i) => keep[i]);
    }
    case 'find': {
      if (!isClosure(fn)) throw new Unsupported('find');
      for (let i = 0; i < list.length; i++) if (apply(fn, [list[i], i, list], fuel)) return list[i];
      return undefined;
    }
    case 'findIndex': {
      if (!isClosure(fn)) throw new Unsupported('findIndex');
      for (let i = 0; i < list.length; i++) if (apply(fn, [list[i], i, list], fuel)) return i;
      return -1;
    }
    case 'some':
      return each((r) => Boolean(r)).some(Boolean);
    case 'every':
      return each((r) => Boolean(r)).every(Boolean);
    case 'forEach':
      each((r) => r);
      return undefined;
    case 'flatMap':
      return capArray(each((r) => r).flat());
    case 'reduce': {
      if (!isClosure(fn)) throw new Unsupported('reduce');
      let acc = args.length > 1 ? args[1] : list[0];
      for (let i = args.length > 1 ? 0 : 1; i < list.length; i++) acc = apply(fn, [acc, list[i], i, list], fuel);
      return acc;
    }
    case 'sort': {
      const copy = [...list];
      if (fn === undefined) return copy.sort();
      if (!isClosure(fn)) throw new Unsupported('sort');
      return copy.sort((x, y) => Number(apply(fn, [x, y], fuel)));
    }
    case 'join':
      return capString(list.map((v) => toText(v, true)).join(args[0] === undefined ? ',' : String(plain(args[0]))));
    case 'includes':
    case 'indexOf':
    case 'lastIndexOf':
    case 'at':
      return (list as any)[name](...args);
    case 'slice':
    case 'concat':
    case 'flat':
      return capArray((list as any)[name](...args));
    case 'reverse':
      return [...list].reverse();
    default:
      throw new Unsupported(`array.${name}`);
  }
}

function* iterable(value: unknown): Iterable<unknown> {
  if (typeof value === 'string' || Array.isArray(value)) {
    if (value.length > MAX_ITEMS) throw new Unsupported('Too many items');
    yield* value;
    return;
  }
  throw new Unsupported('Not iterable');
}

function capArray<T>(a: T[]): T[] {
  if (a.length > MAX_ITEMS) throw new Unsupported('Too many items');
  return a;
}
function capString(s: string): string {
  if (s.length > MAX_STRING) throw new Unsupported('String too long');
  return s;
}

function isClosure(v: unknown): v is Closure {
  return !!v && typeof v === 'object' && (v as Closure).kind === CLOSURE;
}
function isNamespace(v: unknown): v is object {
  return !!v && typeof v === 'object' && 'namespace' in v;
}
function isCallable(v: unknown): boolean {
  return isClosure(v) || v === NOOP || (!!v && typeof v === 'object' && ('fn' in v || (v as MethodRef).kind === METHOD));
}
function isSpecial(v: object): boolean {
  return isClosure(v) || isNamespace(v) || v === NOOP || (v as MethodRef).kind === METHOD;
}

/** Interpreter-internal values must not leak into arithmetic or comparisons. */
function plain(v: unknown): unknown {
  if (v && typeof v === 'object' && isSpecial(v)) throw new Unsupported('Function used as a value');
  return v;
}

/**
 * How a value reads in text, matching what the runtime draws: nothing for null, undefined and booleans; arrays
 * joined without separators (like rendered children) unless `asString` asks for JavaScript's String().
 */
export function toText(v: unknown, asString = false): string {
  if (asString) {
    if (v && typeof v === 'object' && isSpecial(v)) return '';
    if (Array.isArray(v)) return v.map((x) => toText(x, true)).join(',');
    if (v && typeof v === 'object') return '[object Object]';
    return String(v);
  }
  if (v === null || v === undefined || typeof v === 'boolean') return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (Array.isArray(v)) return v.map((x) => toText(x)).join('');
  if (typeof v === 'object' && isSpecial(v)) return '';
  return JSON.stringify(v);
}
