import { RESOLVED_PROP, type Catalog } from '@tessera/catalog';
import type { Diagnostics } from './diagnostics';
import { ALLOWED_GLOBALS, guardExpression, missingBindingPaths } from './guard';
import type { SiteInfo } from './manifest';
import type { UIEach, UIElement, UIIf, UINode } from './markdown';
import type { Directive } from './parse';
import { resolutionFor, type Resolution } from './resolve';

interface Ctx {
  readonly catalog: Catalog;
  readonly diags: Diagnostics;
  readonly constants: string[];
  /** Tool results by name; the model refers to them instead of retyping their values. */
  readonly data: Readonly<Record<string, unknown>>;
  readonly bindings: ReadonlySet<string>;
  readonly resolutions: Resolution[];
  /** Filled with every component in source order, plus the declared names: the manifest. */
  readonly sites: SiteInfo[];
  readonly state: string[];
  readonly lets: string[];
}

/** Where codegen is in the tree, for the sites it records. */
interface Place {
  readonly parent: number | null;
  /** The hidden index variable of each enclosing {#each}, outermost first. */
  readonly loops: readonly string[];
  readonly conditional: boolean;
}

const TOP: Place = { parent: null, loops: [], conditional: false };

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Names in `data` usable as bindings: plain identifiers that do not collide with reserved or global names. */
export function bindingNames(data: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(data).filter((k) => IDENTIFIER.test(k) && !k.startsWith('__') && k !== 'ui' && !ALLOWED_GLOBALS.has(k));
}

const EACH = /^([\s\S]+?)\s+as\s+([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?\s*$/;

/**
 * Emits the program as one function expression. The runtime evaluates it in a sandbox and calls it with
 * (h, Fragment, ui, constants, safe, data); the result is the root component.
 *
 * - Static text lives in the constants table, so text that grows while streaming changes data, not code.
 * - Tool results live in the data table and are read by name, so values on screen are never retyped by the model.
 * - Every expression is wrapped in __safe, so a throwing expression removes one value instead of the whole render.
 * - State is keyed by its name, so its value survives a recompile.
 * - Every component gets a `__site` prop, its index in source order, so the host can tell components apart
 *   across recompiles and restarts. The runtime passes it on beside the props, not among them.
 */
export function generate(directives: readonly Directive[], nodes: readonly UINode[], ctx: Ctx): string {
  const scope = new Set<string>(ctx.bindings);
  const lines: string[] = [];

  for (const d of directives) {
    if (d.name.startsWith('__') || d.name === 'ui' || ALLOWED_GLOBALS.has(d.name)) {
      ctx.diags.error('reserved_name', `${d.name} is reserved`, d.pos);
      continue;
    }
    const setter = d.kind === 'state' ? 'set' + d.name[0]!.toUpperCase() + d.name.slice(1) : null;
    if (scope.has(d.name) || (setter && scope.has(setter))) {
      ctx.diags.error('duplicate_name', ctx.bindings.has(d.name) ? `${d.name} is already the name of tool data` : `${d.name} is declared twice`, d.pos);
      continue;
    }
    const value = checked(d.source, scope, d.pos, ctx) ?? 'undefined';
    if (d.kind === 'state') {
      lines.push(`const [${d.name}, ${setter}] = __ui.useState(${JSON.stringify(d.name)}, () => __safe(() => (${value}), undefined));`);
      scope.add(d.name).add(setter!);
      ctx.state.push(d.name);
    } else {
      lines.push(`const ${d.name} = __safe(() => (${value}), undefined);`);
      scope.add(d.name);
      ctx.lets.push(d.name);
    }
  }

  const body = children(nodes, scope, ctx, TOP);
  return [
    '(function (__h, __F, __ui, __C, __safe, __D) {',
    '  "use strict";',
    '  const ui = __ui.api;',
    ...[...ctx.bindings].map((name) => `  const ${name} = __D[${JSON.stringify(name)}];`),
    '  return function TesseraProgram() {',
    ...lines.map((l) => '    ' + l),
    `    return __h(__F, null${body});`,
    '  };',
    '})',
  ].join('\n');
}

/** Comma-prefixed list of child expressions, ready to append to an __h(...) call. */
function children(nodes: readonly UINode[], scope: ReadonlySet<string>, ctx: Ctx, at: Place): string {
  let out = '';
  for (const n of nodes) {
    const code = node(n, scope, ctx, at);
    if (code) out += ', ' + code;
  }
  return out;
}

function node(n: UINode, scope: ReadonlySet<string>, ctx: Ctx, at: Place): string | null {
  switch (n.kind) {
    case 'text':
      return n.value ? `__C[${ctx.constants.push(n.value) - 1}]` : null;
    case 'expr': {
      const src = checked(n.source, scope, n.pos, ctx);
      return src === null ? null : `__ui.value(__safe(() => (${src}), null))`;
    }
    case 'el':
      return element(n, scope, ctx, at);
    case 'if':
      return ifBlock(n, scope, ctx, at);
    case 'each':
      return eachBlock(n, scope, ctx, at);
  }
}

function element(n: UIElement, scope: ReadonlySet<string>, ctx: Ctx, at: Place): string {
  const spec = ctx.catalog.get(n.name)!;
  // Recorded before the children, so sites follow source order.
  const site = ctx.sites.length;
  const literalProps: Record<string, unknown> = {};
  const dynamicProps: string[] = [];
  const events: string[] = [];
  ctx.sites.push({
    site,
    component: n.name,
    parent: at.parent,
    origin: n.pos < 0 ? 'markdown' : 'tag',
    pos: n.pos,
    literalProps,
    dynamicProps,
    events,
    loopDepth: at.loops.length,
    conditional: at.conditional,
  });
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
      checkFields(guard.ast, attr.pos, ctx);
      if (guard.literal && !validLiteral(n.name, attr.name, guard.literal.value, attr.pos, ctx)) continue;
      props.push(`${key}: __safe(() => (${attr.value.source}), undefined)`);
      if (isEvent) {
        if (!guard.literal) events.push(attr.name);
      } else if (guard.literal) literalProps[attr.name] = guard.literal.value;
      else dynamicProps.push(attr.name);
      continue;
    }
    const value = attr.value.kind === 'string' ? attr.value.value : true;
    if (isEvent) {
      ctx.diags.error('invalid_literal', `<${n.name}> ${attr.name} needs a {function}, not a literal`, attr.pos);
      continue;
    }
    if (!validLiteral(n.name, attr.name, value, attr.pos, ctx)) continue;
    props.push(`${key}: ${JSON.stringify(value)}`);
    literalProps[attr.name] = value;
  }
  const resolution = resolutionFor(spec, n.attrs, (source) => guardExpression(source, scope).literal);
  if (resolution && 'dynamic' in resolution) {
    ctx.diags.warn('dynamic_resolver_input', `<${n.name}> ${resolution.dynamic} must be a literal for the server to resolve it; it stays unresolved`, n.pos);
  } else if (resolution && Object.entries(resolution.input).every(([prop, value]) => !ctx.catalog.checkProp(n.name, prop, value))) {
    // (Invalid literal props were already reported above; such an element is not sent to the resolver.)
    if (!ctx.resolutions.some((r) => r.key === resolution.key)) ctx.resolutions.push(resolution);
    props.push(`${JSON.stringify(RESOLVED_PROP)}: __safe(() => __D[${JSON.stringify(resolution.key)}], undefined)`);
  }
  // Outside loops the site is a constant; inside, each item gets its own instance id: "4:0", "4:1", nested "4:1.0".
  props.push(`"__site": ${at.loops.length ? `${JSON.stringify(`${site}:`)} + ${at.loops.join(' + "." + ')}` : JSON.stringify(String(site))}`);
  return `__h(${JSON.stringify(n.name)}, { ${props.join(', ')} }${children(n.children, scope, ctx, { ...at, parent: site })})`;
}

function ifBlock(n: UIIf, scope: ReadonlySet<string>, ctx: Ctx, at: Place): string | null {
  // Branches are compiled in source order, which keeps the sites inside them in source order too.
  const inner: Place = { ...at, conditional: true };
  const compiled = n.branches.map((b) => ({
    test: b.test === null ? null : checked(b.test, scope, b.pos, ctx),
    otherwise: b.test === null,
    frag: `__h(__F, null${children(b.children, scope, ctx, inner)})`,
  }));
  let code = 'null';
  for (let i = compiled.length - 1; i >= 0; i--) {
    const b = compiled[i]!;
    if (b.otherwise) code = b.frag;
    else if (b.test !== null) code = `(${b.test}) ? ${b.frag} : ${code}`;
  }
  return code === 'null' ? null : `__safe(() => ${code}, null)`;
}

function eachBlock(n: UIEach, scope: ReadonlySet<string>, ctx: Ctx, at: Place): string | null {
  const m = EACH.exec(n.source);
  if (!m) {
    ctx.diags.error('invalid_expression', `{#each ${n.source}} must look like {#each list as item, i}`, n.pos);
    return null;
  }
  // `__` names are the program's own; a loop variable named like one would shadow it.
  const reserved = [m[2]!, m[3]].find((name) => name?.startsWith('__'));
  if (reserved) {
    ctx.diags.error('reserved_name', `${reserved} is reserved; the {#each} block was dropped`, n.pos);
    return null;
  }
  const list = checked(m[1]!, scope, n.pos, ctx);
  if (list === null) return null;
  const item = m[2]!;
  const index = m[3] ?? '__i';
  const inner = new Set(scope).add(item).add(index);
  // A hidden copy of the index per loop level: the model may reuse one index name in nested loops.
  const hidden = `__k${at.loops.length}`;
  const body = children(n.children, inner, ctx, { ...at, loops: [...at.loops, hidden] });
  return `__safe(() => Array.from(${list}).map((${item}, ${index}) => { const ${hidden} = ${index}; return __h(__F, { key: ${index} }${body}); }), null)`;
}

/** Returns the source when it passes the guard, otherwise reports and returns null. */
function checked(source: string, scope: ReadonlySet<string>, pos: number, ctx: Ctx): string | null {
  const guard = guardExpression(source, scope);
  if (report(guard.issues, pos, ctx)) return null;
  checkFields(guard.ast, pos, ctx);
  return source;
}

/** A fixed path into tool data that does not exist renders nothing; tell the model which field it got wrong. */
function checkFields(ast: unknown, pos: number, ctx: Ctx): void {
  if (!ctx.bindings.size || !ast) return;
  for (const path of missingBindingPaths(ast, ctx.data, ctx.bindings)) {
    ctx.diags.warn('unknown_field', `${path} does not exist in the tool data`, pos);
  }
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
