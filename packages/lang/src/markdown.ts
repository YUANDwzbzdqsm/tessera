import type { Catalog } from '@tessera/catalog';
import type { Diagnostics } from './diagnostics';
import type { EachNode, ElementNode, IfNode, Node } from './parse';
import type { RawAttr } from './tokenize';

/** The tree after Markdown has been turned into catalog components. Codegen works on this. */
export type UINode = UIElement | UIText | UIExpr | UIIf | UIEach;

export interface UIElement {
  readonly kind: 'el';
  readonly name: string;
  readonly attrs: readonly RawAttr[];
  readonly children: UINode[];
  readonly pos: number;
}
export interface UIText {
  readonly kind: 'text';
  value: string;
}
export interface UIExpr {
  readonly kind: 'expr';
  readonly source: string;
  readonly pos: number;
}
export interface UIIf {
  readonly kind: 'if';
  readonly branches: { readonly test: string | null; readonly pos: number; readonly children: UINode[] }[];
  readonly pos: number;
}
export interface UIEach {
  readonly kind: 'each';
  readonly source: string;
  readonly pos: number;
  readonly children: UINode[];
}

interface Ctx {
  readonly catalog: Catalog;
  readonly diags: Diagnostics;
}

const HEADING = /^(#{1,3})\s+/;
const BULLET = /^[-*]\s+/;
const ORDERED = /^\d+[.)]\s+/;
const HEADING_SIZE = ['xl', 'lg', 'md'] as const;

/** Root content is block content. */
export function toUI(nodes: readonly Node[], catalog: Catalog, diags: Diagnostics): UINode[] {
  return blockContent(nodes, { catalog, diags });
}

type Item = { type: 'line'; atoms: Node[] } | { type: 'block'; node: Node };

/** Markdown blocks: headings, paragraphs and lists, with block-level components and control blocks between them. */
function blockContent(nodes: readonly Node[], ctx: Ctx): UINode[] {
  const items: Item[] = [];
  let line: Node[] = [];
  const endLine = () => {
    items.push({ type: 'line', atoms: line });
    line = [];
  };
  const lineIsBlank = () => line.every((a) => a.kind === 'text' && a.value.trim() === '');

  for (const node of nodes) {
    if (node.kind === 'text') {
      const parts = node.value.split('\n');
      parts.forEach((part, i) => {
        if (i > 0) endLine();
        if (part) line.push({ kind: 'text', value: part, pos: node.pos });
      });
    } else if (node.kind === 'expr') {
      line.push(node);
    } else {
      const forcedBlock = node.kind === 'element' && ctx.catalog.get(node.name)?.children === 'block';
      if (lineIsBlank() || forcedBlock) {
        if (!lineIsBlank()) endLine();
        line = [];
        items.push({ type: 'block', node });
      } else {
        line.push(node);
      }
    }
  }
  endLine();

  const out: UINode[] = [];
  let paragraph: Node[][] = [];
  let list: { ordered: boolean; items: Node[][] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      const atoms: Node[] = [];
      paragraph.forEach((l, i) => {
        if (i > 0) atoms.push({ kind: 'text', value: '\n', pos: -1 });
        atoms.push(...l);
      });
      out.push(markdownElement('Text', inlineContent(atoms, ctx)));
    }
    paragraph = [];
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((atoms) => markdownElement('ListItem', inlineContent(atoms, ctx)));
      out.push(markdownElement('List', items, list.ordered ? [{ name: 'ordered', value: { kind: 'bool' }, pos: -1 }] : []));
    }
    list = null;
  };

  for (const item of items) {
    if (item.type === 'block') {
      flushParagraph();
      flushList();
      const ui = blockNode(item.node, ctx);
      if (ui) out.push(ui);
      continue;
    }
    const atoms = trimLeadingSpace(item.atoms);
    const first = atoms[0];
    if (!atoms.some((a) => a.kind !== 'text' || a.value.trim() !== '')) {
      flushParagraph();
      flushList();
      continue;
    }
    const head = first?.kind === 'text' ? first.value : '';
    let m: RegExpExecArray | null;
    if ((m = HEADING.exec(head))) {
      flushParagraph();
      flushList();
      const size = HEADING_SIZE[m[1]!.length - 1]!;
      const content = inlineContent(stripPrefix(atoms, m[0].length), ctx);
      out.push(markdownElement('Title', content, [{ name: 'size', value: { kind: 'string', value: size }, pos: -1 }]));
    } else if ((m = BULLET.exec(head)) || (m = ORDERED.exec(head))) {
      flushParagraph();
      const ordered = ORDERED.test(head);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(stripPrefix(atoms, m[0].length));
    } else {
      flushList();
      paragraph.push(atoms);
    }
  }
  flushParagraph();
  flushList();
  return out;
}

function blockNode(node: Node, ctx: Ctx): UINode | null {
  if (node.kind === 'element') return element(node, ctx);
  if (node.kind === 'if') return ifNode(node, ctx, blockContent);
  if (node.kind === 'each') return eachNode(node, ctx, blockContent);
  return null;
}

function element(node: ElementNode, ctx: Ctx): UIElement | null {
  const spec = ctx.catalog.get(node.name);
  if (!spec) {
    ctx.diags.error('unknown_component', `<${node.name}> is not in the catalog and was dropped`, node.pos);
    return null;
  }
  let children: UINode[] = [];
  if (spec.children === 'none') {
    if (node.children.some((c) => c.kind !== 'text' || c.value.trim() !== '')) {
      ctx.diags.error('children_not_allowed', `<${node.name}> takes no children; they were dropped`, node.pos);
    }
  } else if (spec.children === 'inline') {
    children = inlineContent(node.children, ctx);
  } else {
    children = blockContent(node.children, ctx);
  }
  return { kind: 'el', name: node.name, attrs: node.attrs, children, pos: node.pos };
}

function ifNode(node: IfNode, ctx: Ctx, content: (n: readonly Node[], c: Ctx) => UINode[]): UIIf {
  return {
    kind: 'if',
    pos: node.pos,
    branches: node.branches.map((b) => ({ test: b.test, pos: b.pos, children: content(b.children, ctx) })),
  };
}

function eachNode(node: EachNode, ctx: Ctx, content: (n: readonly Node[], c: Ctx) => UINode[]): UIEach {
  return { kind: 'each', source: node.source, pos: node.pos, children: content(node.children, ctx) };
}

function markdownElement(name: string, children: UINode[], attrs: RawAttr[] = []): UIElement {
  return { kind: 'el', name, attrs, children, pos: -1 };
}

/**
 * Inline content: text with **bold**, *italic* and `code`, expressions, inline components and control blocks.
 * Unclosed markers are closed at the end, so a streaming prefix renders sensibly.
 */
function inlineContent(nodes: readonly Node[], ctx: Ctx): UINode[] {
  const items: (string | Node)[] = [];
  for (const n of trimEdges(nodes)) {
    if (n.kind === 'text') items.push(...n.value);
    else items.push(n);
  }

  const root: UIElement = markdownElement('Root', []);
  const stack: UIElement[] = [root];
  const top = () => stack[stack.length - 1]!;
  const open = (name: string) => {
    const el = markdownElement(name, []);
    top().children.push(el);
    stack.push(el);
  };
  const closeTo = (name: string) => {
    while (stack.length > 1) if (stack.pop()!.name === name) return;
  };
  const isOpen = (name: string) => stack.some((s) => s.name === name);
  const pushText = (s: string) => {
    const kids = top().children;
    const last = kids[kids.length - 1];
    if (last?.kind === 'text') last.value += s;
    else kids.push({ kind: 'text', value: s });
  };
  const charAt = (i: number): string => {
    const it = items[i];
    return it === undefined ? '' : typeof it === 'string' ? it : 'x';
  };
  const space = (c: string) => c === '' || /\s/.test(c);

  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (typeof it !== 'string') {
      const ui = inlineNode(it, ctx);
      if (ui) top().children.push(ui);
      continue;
    }
    if (top().name === 'Code') {
      if (it === '`') stack.pop();
      else pushText(it);
      continue;
    }
    if (it === '`') {
      open('Code');
      continue;
    }
    if (it === '*' && charAt(i + 1) === '*') {
      if (isOpen('Bold') && !space(charAt(i - 1))) closeTo('Bold');
      else if (!space(charAt(i + 2))) open('Bold');
      else pushText('**');
      i++;
      continue;
    }
    if (it === '*') {
      if (isOpen('Italic') && !space(charAt(i - 1))) closeTo('Italic');
      else if (!space(charAt(i + 1)) && space(charAt(i - 1))) open('Italic');
      else pushText('*');
      continue;
    }
    pushText(it);
  }
  return root.children;
}

function inlineNode(node: Node, ctx: Ctx): UINode | null {
  if (node.kind === 'expr') return node;
  if (node.kind === 'element') return element(node, ctx);
  if (node.kind === 'if') return ifNode(node, ctx, inlineContent);
  if (node.kind === 'each') return eachNode(node, ctx, inlineContent);
  return null;
}

function trimLeadingSpace(atoms: Node[]): Node[] {
  const first = atoms[0];
  if (first?.kind !== 'text') return atoms;
  return [{ ...first, value: first.value.replace(/^\s+/, '') }, ...atoms.slice(1)];
}

function stripPrefix(atoms: Node[], length: number): Node[] {
  const first = atoms[0];
  if (first?.kind !== 'text') return atoms;
  return [{ ...first, value: first.value.slice(length) }, ...atoms.slice(1)];
}

/** Drops leading whitespace of the first text and trailing whitespace of the last text. */
function trimEdges(nodes: readonly Node[]): Node[] {
  const out = [...nodes];
  const first = out[0];
  if (first?.kind === 'text') out[0] = { ...first, value: first.value.replace(/^\s+/, '') };
  const last = out[out.length - 1];
  if (last?.kind === 'text') out[out.length - 1] = { ...last, value: last.value.replace(/\s+$/, '') };
  return out.filter((n) => n.kind !== 'text' || n.value !== '');
}
