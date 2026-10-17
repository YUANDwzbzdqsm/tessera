import type { Catalog } from '@tessera/catalog';
import type { Diagnostics } from './diagnostics';
import { ALLOWED_GLOBALS, guardExpression } from './guard';
import type { UIEach, UIElement, UIIf, UINode } from './markdown';
import type { Directive } from './parse';

interface Ctx {
  readonly catalog: Catalog;
  readonly diags: Diagnostics;
  readonly constants: string[];
}

const EACH = /^([\s\S]+?)\s+as\s+([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?\s*$/;

/**
 * Emits the program as one function expression. The runtime evaluates it in a sandbox and calls it with
 * (h, Fragment, ui, constants, safe); the result is the root component.
 *
 * - Static text lives in the constants table, so text that grows while streaming changes data, not code.
 * - Every expression is wrapped in __safe, so a throwing expression removes one value instead of the whole render.
 * - State is keyed by its name, so its value survives a recompile.
 */
export function generate(directives: readonly Directive[], nodes: readonly UINode[], ctx: Ctx): string {
  const scope = new Set<string>();
  const lines: string[] = [];

  for (const d of directives) {
    if (d.name.startsWith('__') || d.name === 'ui' || ALLOWED_GLOBALS.has(d.name)) {
      ctx.diags.error('reserved_name', `${d.name} is reserved`, d.pos);
      continue;
    }
    const setter = d.kind === 'state' ? 'set' + d.name[0]!.toUpperCase() + d.name.slice(1) : null;
    if (scope.has(d.name) || (setter && scope.has(setter))) {
      ctx.diags.error('duplicate_name', `${d.name} is declared twice`, d.pos);
      continue;
    }
    const value = checked(d.source, scope, d.pos, ctx) ?? 'undefined';
    if (d.kind === 'state') {
      lines.push(`const [${d.name}, ${setter}] = __ui.useState(${JSON.stringify(d.name)}, () => __safe(() => (${value}), undefined));`);
      scope.add(d.name).add(setter!);
    } else {
      lines.push(`const ${d.name} = __safe(() => (${value}), undefined);`);
      scope.add(d.name);
    }
  }

  const body = children(nodes, scope, ctx);
  return [
    '(function (__h, __F, __ui, __C, __safe) {',
    '  "use strict";',
    '  const ui = __ui.api;',
    '  return function TesseraProgram() {',
    ...lines.map((l) => '    ' + l),
    `    return __h(__F, null${body});`,
    '  };',
    '})',
  ].join('\n');
}

/** Comma-prefixed list of child expressions, ready to append to an __h(...) call. */
function children(nodes: readonly UINode[], scope: ReadonlySet<string>, ctx: Ctx): string {
  let out = '';
  for (const n of nodes) {
    const code = node(n, scope, ctx);
    if (code) out += ', ' + code;
  }
  return out;
}

function node(n: UINode, scope: ReadonlySet<string>, ctx: Ctx): string | null {
  switch (n.kind) {
    case 'text':
      return n.value ? `__C[${ctx.constants.push(n.value) - 1}]` : null;
    case 'expr': {
      const src = checked(n.source, scope, n.pos, ctx);
      return src === null ? null : `__ui.value(__safe(() => (${src}), null))`;
    }
    case 'el':
      return element(n, scope, ctx);
    case 'if':
      return ifBlock(n, scope, ctx);
    case 'each':
      return eachBlock(n, scope, ctx);
  }
}

function element(n: UIElement, scope: ReadonlySet<string>, ctx: Ctx): string {
  const spec = ctx.catalog.get(n.name)!;
  const props: string[] = [];
  for (const attr of n.attrs) {
    const isEvent = spec.events.includes(attr.name);
    if (!isEvent && !(attr.name in spec.props.shape)) {
      ctx.diags.error('unknown_prop', `<${n.name}> has no prop ${attr.name}; it was dropped`, attr.pos);
      continue;
    }
    const key = JSON.stringify(attr.name);
    if (attr.value.kind === 'expr') {
      const guard = guardExpression(attr.value.source, scope);
      if (report(guard.issues, attr.pos, ctx)) continue;
      if (guard.literal && !validLiteral(n.name, attr.name, guard.literal.value, attr.pos, ctx)) continue;
      props.push(`${key}: __safe(() => (${attr.value.source}), undefined)`);
      continue;
    }
    const value = attr.value.kind === 'string' ? attr.value.value : true;
    if (isEvent) {
      ctx.diags.error('invalid_literal', `<${n.name}> ${attr.name} needs a {function}, not a literal`, attr.pos);
      continue;
    }
    if (!validLiteral(n.name, attr.name, value, attr.pos, ctx)) continue;
    props.push(`${key}: ${JSON.stringify(value)}`);
  }
  const propsCode = props.length ? `{ ${props.join(', ')} }` : 'null';
  return `__h(${JSON.stringify(n.name)}, ${propsCode}${children(n.children, scope, ctx)})`;
}

function ifBlock(n: UIIf, scope: ReadonlySet<string>, ctx: Ctx): string | null {
  let code = 'null';
  for (let i = n.branches.length - 1; i >= 0; i--) {
    const b = n.branches[i]!;
    const frag = `__h(__F, null${children(b.children, scope, ctx)})`;
    if (b.test === null) {
      code = frag;
      continue;
    }
    const test = checked(b.test, scope, b.pos, ctx);
    if (test !== null) code = `(${test}) ? ${frag} : ${code}`;
  }
  return code === 'null' ? null : `__safe(() => ${code}, null)`;
}

function eachBlock(n: UIEach, scope: ReadonlySet<string>, ctx: Ctx): string | null {
  const m = EACH.exec(n.source);
  if (!m) {
    ctx.diags.error('invalid_expression', `{#each ${n.source}} must look like {#each list as item, i}`, n.pos);
    return null;
  }
  const list = checked(m[1]!, scope, n.pos, ctx);
  if (list === null) return null;
  const item = m[2]!;
  const index = m[3] ?? '__i';
  const inner = new Set(scope).add(item).add(index);
  return `__safe(() => Array.from(${list}).map((${item}, ${index}) => __h(__F, { key: ${index} }${children(n.children, inner, ctx)})), null)`;
}

/** Returns the source when it passes the guard, otherwise reports and returns null. */
function checked(source: string, scope: ReadonlySet<string>, pos: number, ctx: Ctx): string | null {
  const guard = guardExpression(source, scope);
  return report(guard.issues, pos, ctx) ? null : source;
}

function report(issues: readonly { code: 'invalid_expression' | 'forbidden_syntax' | 'unknown_identifier'; message: string }[], pos: number, ctx: Ctx): boolean {
  for (const issue of issues) ctx.diags.error(issue.code, issue.message + '; the expression was dropped', pos);
  return issues.length > 0;
}

function validLiteral(component: string, prop: string, value: unknown, pos: number, ctx: Ctx): boolean {
  const issue = ctx.catalog.checkProp(component, prop, value);
  if (!issue) return true;
  ctx.diags.error('invalid_literal', `${issue.message}; the prop was dropped`, pos);
  return false;
}
