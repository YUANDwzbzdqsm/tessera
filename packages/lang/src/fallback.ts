import type { Catalog } from '@tessera/catalog';
import { RESOLVED_PROP } from '@tessera/catalog';
import { bindingNames } from './codegen';
import { Diagnostics } from './diagnostics';
import { NOOP, Scope, evaluate, toText, type Fuel } from './evaluate';
import { guardExpression } from './guard';
import type { UIElement, UINode } from './markdown';
import { toUI } from './markdown';
import { parse } from './parse';
import { resolutionFor } from './resolve';
import { tokenize } from './tokenize';

export interface FallbackOptions {
  readonly catalog: Catalog;
  /** Tool results and resolver results, as given to the program. */
  readonly data?: Readonly<Record<string, unknown>>;
  /** State to render with instead of each @state's initial value, e.g. what the user left. */
  readonly state?: Readonly<Record<string, unknown>>;
  /** Total evaluation budget for the whole document. */
  readonly fuel?: number;
}

const EACH = /^([\s\S]+?)\s+as\s+([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?\s*$/;
const TITLE_LEVEL: Record<string, number> = { xl: 1, lg: 2, md: 3, sm: 4 };
const PLACEHOLDER = '…';

/**
 * A plain-Markdown version of an answer, for clients that cannot run programs (older apps, email, search).
 * Unlike a static dump, expressions are evaluated at the initial (or given) state, so computed values such as
 * prices and list items appear. Interactive parts become static text; what cannot be evaluated shows `…`.
 */
export function toFallbackMarkdown(source: string, { catalog, data = {}, state = {}, fuel = 200_000 }: FallbackOptions): string {
  const diags = new Diagnostics();
  const { nodes, directives } = parse(tokenize(source, diags), diags);
  const ui = toUI(nodes, catalog, diags);
  const budget: Fuel = { remaining: fuel };

  const root = new Scope();
  for (const name of bindingNames(data)) root.vars.set(name, data[name]);
  for (const d of directives) {
    if (root.vars.has(d.name)) continue;
    if (d.kind === 'state') {
      root.vars.set(d.name, d.name in state ? state[d.name] : attempt(() => evaluate(d.source, root, budget)));
      root.vars.set('set' + d.name[0]!.toUpperCase() + d.name.slice(1), NOOP);
    } else {
      root.vars.set(d.name, attempt(() => evaluate(d.source, root, budget)));
    }
  }

  const ctx: Ctx = { catalog, data, budget };
  return tidy(blocks(ui, root, ctx));
}

interface Ctx {
  readonly catalog: Catalog;
  readonly data: Readonly<Record<string, unknown>>;
  readonly budget: Fuel;
}

function attempt(fn: () => unknown): unknown {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function blocks(nodes: readonly UINode[], scope: Scope, ctx: Ctx): string {
  return nodes
    .map((n) => node(n, scope, ctx, 'block'))
    .filter((s) => s.trim() !== '')
    .join('\n\n');
}

function inline(nodes: readonly UINode[], scope: Scope, ctx: Ctx): string {
  return nodes.map((n) => node(n, scope, ctx, 'inline')).join('');
}

function node(n: UINode, scope: Scope, ctx: Ctx, mode: 'block' | 'inline'): string {
  switch (n.kind) {
    case 'text':
      return n.value;
    case 'expr':
      try {
        return toText(evaluate(n.source, scope, ctx.budget));
      } catch {
        return PLACEHOLDER;
      }
    case 'el':
      return element(n, scope, ctx);
    case 'if': {
      for (const b of n.branches) {
        let pass: unknown;
        try {
          pass = b.test === null ? true : evaluate(b.test, scope, ctx.budget);
        } catch {
          return '';
        }
        if (pass) return mode === 'block' ? blocks(b.children, scope, ctx) : inline(b.children, scope, ctx);
      }
      return '';
    }
    case 'each': {
      const m = EACH.exec(n.source);
      if (!m) return '';
      let list: unknown;
      try {
        list = evaluate(m[1]!, scope, ctx.budget);
      } catch {
        return '';
      }
      if (!Array.isArray(list)) return '';
      const parts = list.map((item, i) => {
        const inner = new Scope(scope);
        inner.vars.set(m[2]!, item);
        if (m[3]) inner.vars.set(m[3], i);
        return mode === 'block' ? blocks(n.children, inner, ctx) : inline(n.children, inner, ctx);
      });
      return mode === 'block' ? parts.filter((p) => p.trim()).join('\n\n') : parts.join('');
    }
  }
}

function element(n: UIElement, scope: Scope, ctx: Ctx): string {
  switch (n.name) {
    case 'Title': {
      const size = props(n, scope, ctx).size;
      return `${'#'.repeat(TITLE_LEVEL[String(size)] ?? 2)} ${inline(n.children, scope, ctx).trim()}`;
    }
    case 'Text':
      // A line break inside a paragraph stays a line break.
      return inline(n.children, scope, ctx).replace(/\n/g, '  \n');
    case 'Bold':
      return wrap('**', inline(n.children, scope, ctx));
    case 'Italic':
      return wrap('*', inline(n.children, scope, ctx));
    case 'Code':
      return wrap('`', inline(n.children, scope, ctx));
    case 'List': {
      const ordered = props(n, scope, ctx).ordered === true;
      let index = 0;
      return listItems(n.children, scope, ctx)
        .map((item) => `${ordered ? `${++index}.` : '-'} ${item}`)
        .join('\n');
    }
    case 'ListItem':
      return `- ${inline(n.children, scope, ctx)}`;
  }

  const spec = ctx.catalog.get(n.name);
  if (!spec) return '';
  const values = props(n, scope, ctx);
  if (spec.resolver) {
    const resolution = resolutionFor(spec, n.attrs, (src) => guardExpression(src, new Set()).literal);
    if (resolution && !('dynamic' in resolution)) values[RESOLVED_PROP] = ctx.data[resolution.key];
  }
  const children = spec.children === 'block' ? blocks(n.children, scope, ctx) : spec.children === 'inline' ? inline(n.children, scope, ctx) : '';
  return spec.fallback ? spec.fallback(values, children) : children;
}

/** List items render their own content; control blocks inside a list expand to their items. */
function listItems(nodes: readonly UINode[], scope: Scope, ctx: Ctx): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.kind === 'el' && n.name === 'ListItem') out.push(inline(n.children, scope, ctx));
    else {
      const rendered = node(n, scope, ctx, 'block');
      for (const line of rendered.split('\n')) if (line.trim()) out.push(line.replace(/^- /, ''));
    }
  }
  return out;
}

function props(n: UIElement, scope: Scope, ctx: Ctx): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const attr of n.attrs) {
    if (attr.value.kind === 'string') out[attr.name] = attr.value.value;
    else if (attr.value.kind === 'bool') out[attr.name] = true;
    else {
      const source = attr.value.source;
      out[attr.name] = attempt(() => evaluate(source, scope, ctx.budget));
    }
  }
  return out;
}

function wrap(marker: string, text: string): string {
  return text ? `${marker}${text}${marker}` : '';
}

function tidy(markdown: string): string {
  return markdown.replace(/\n{3,}/g, '\n\n').trim();
}
