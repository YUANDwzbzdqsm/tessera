import type { Diagnostics } from './diagnostics';
import type { RawAttr, Token } from './tokenize';

export type Node = ElementNode | TextNode | ExprNode | IfNode | EachNode | CodeNode;

export interface ElementNode {
  readonly kind: 'element';
  readonly name: string;
  readonly attrs: RawAttr[];
  readonly children: Node[];
  readonly pos: number;
}
export interface TextNode {
  readonly kind: 'text';
  readonly value: string;
  readonly pos: number;
}
export interface ExprNode {
  readonly kind: 'expr';
  readonly source: string;
  readonly pos: number;
}
/** Verbatim code from a ``` fence (block) or a `span`. Its text is never parsed or evaluated. */
export interface CodeNode {
  readonly kind: 'code';
  readonly value: string;
  readonly lang: string;
  readonly block: boolean;
  readonly pos: number;
}
export interface IfBranch {
  readonly test: string | null;
  readonly children: Node[];
  readonly pos: number;
}
export interface IfNode {
  readonly kind: 'if';
  readonly branches: IfBranch[];
  readonly pos: number;
}
export interface EachNode {
  readonly kind: 'each';
  readonly source: string;
  readonly children: Node[];
  readonly pos: number;
}

export interface Directive {
  readonly kind: 'state' | 'let';
  readonly name: string;
  readonly source: string;
  readonly pos: number;
}

export interface ParseResult {
  readonly nodes: Node[];
  readonly directives: Directive[];
}

type Frame =
  | { readonly type: 'root'; children: Node[] }
  | { readonly type: 'element'; readonly node: ElementNode; children: Node[]; readonly parent: Node[] }
  | { readonly type: 'if'; readonly node: IfNode; children: Node[]; readonly parent: Node[] }
  | { readonly type: 'each'; readonly node: EachNode; children: Node[]; readonly parent: Node[] };

const DIRECTIVE = /^(state|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/;

/**
 * Builds the node tree. Unclosed elements and blocks at the end are closed when they already have content
 * and dropped when they are empty, so a half-written source still yields a usable tree.
 *
 * `voidNames` are components that take no children. Like HTML void elements they never open a scope: a `<Divider>`
 * written without the slash is treated as `<Divider />`, so it cannot swallow the rest of the answer, and a matching
 * `</Divider>` is ignored. (Both models in the M5 benchmark lost whole sections to exactly this.)
 */
export function parse(tokens: readonly Token[], diags: Diagnostics, voidNames: ReadonlySet<string> = new Set()): ParseResult {
  const root: Frame = { type: 'root', children: [] };
  const stack: Frame[] = [root];
  const directives: Directive[] = [];
  const top = () => stack[stack.length - 1]!;

  for (const tok of tokens) {
    switch (tok.t) {
      case 'text':
        top().children.push({ kind: 'text', value: tok.value, pos: tok.pos });
        break;
      case 'expr':
        top().children.push({ kind: 'expr', source: tok.source, pos: tok.pos });
        break;
      case 'code':
        top().children.push({ kind: 'code', value: tok.value, lang: tok.lang, block: tok.block, pos: tok.pos });
        break;
      case 'directive': {
        // Elements open no scope, so a directive nested only in elements means the same at the top level. Models often
        // wrap a whole answer in <Box> (one benchmark answer lost every name to this). Inside {#if} or {#each} it would
        // mean something else, so it stays an error there.
        if (stack.some((f) => f.type === 'if' || f.type === 'each')) {
          diags.error('directive_not_top_level', `{@${tok.source}} must be at the top level, not inside {#if} or {#each}`, tok.pos);
          break;
        }
        const m = DIRECTIVE.exec(tok.source);
        if (!m) {
          diags.error('unknown_directive', `Unknown directive {@${tok.source}}`, tok.pos);
          break;
        }
        if (stack.length > 1) diags.warn('directive_hoisted', `{@${m[1]} ${m[2]}} is inside an element; it was moved to the top level`, tok.pos);
        directives.push({ kind: m[1] as 'state' | 'let', name: m[2]!, source: m[3]!.trim(), pos: tok.pos });
        break;
      }
      case 'open': {
        const node: ElementNode = { kind: 'element', name: tok.name, attrs: tok.attrs, children: [], pos: tok.pos };
        top().children.push(node);
        if (tok.self) break;
        if (voidNames.has(tok.name)) {
          diags.warn('missing_self_close', `<${tok.name}> takes no children; treated as <${tok.name} />`, tok.pos);
          break;
        }
        stack.push({ type: 'element', node, children: node.children, parent: top().children });
        break;
      }
      case 'close': {
        const at = findFrame(stack, (f) => f.type === 'element' && f.node.name === tok.name);
        if (at < 0) {
          // The closing half of a void component written as <Divider></Divider>: nothing to close.
          if (!voidNames.has(tok.name)) diags.error('mismatched_close', `</${tok.name}> has no matching open tag`, tok.pos);
          break;
        }
        closeAbove(stack, at, diags);
        stack.pop();
        break;
      }
      case 'if': {
        const node: IfNode = { kind: 'if', branches: [{ test: tok.test, children: [], pos: tok.pos }], pos: tok.pos };
        top().children.push(node);
        stack.push({ type: 'if', node, children: node.branches[0]!.children, parent: top().children });
        break;
      }
      case 'elseif':
      case 'else': {
        const at = findFrame(stack, (f) => f.type === 'if');
        if (at < 0) {
          diags.error('stray_block', `{:else} outside {#if}`, tok.pos);
          break;
        }
        closeAbove(stack, at, diags);
        const frame = stack[at] as Extract<Frame, { type: 'if' }>;
        const branch: IfBranch = { test: tok.t === 'elseif' ? tok.test : null, children: [], pos: tok.pos };
        frame.node.branches.push(branch);
        frame.children = branch.children;
        break;
      }
      case 'endif':
      case 'endeach': {
        const want = tok.t === 'endif' ? 'if' : 'each';
        const at = findFrame(stack, (f) => f.type === want);
        if (at < 0) {
          diags.error('stray_block', `{/${want}} without an opening block`, tok.pos);
          break;
        }
        closeAbove(stack, at, diags);
        stack.pop();
        break;
      }
      case 'each': {
        const node: EachNode = { kind: 'each', source: tok.source, children: [], pos: tok.pos };
        top().children.push(node);
        stack.push({ type: 'each', node, children: node.children, parent: top().children });
        break;
      }
    }
  }

  while (stack.length > 1) {
    finishFrame(stack.pop()!, diags);
  }
  return { nodes: root.children, directives };
}

function findFrame(stack: Frame[], test: (f: Frame) => boolean): number {
  for (let i = stack.length - 1; i > 0; i--) if (test(stack[i]!)) return i;
  return -1;
}

/** Implicitly closes every frame above `index`. */
function closeAbove(stack: Frame[], index: number, diags: Diagnostics): void {
  while (stack.length - 1 > index) finishFrame(stack.pop()!, diags);
}

function finishFrame(frame: Frame, diags: Diagnostics): void {
  if (frame.type === 'root') return;
  const node = frame.node;
  const hasContent =
    node.kind === 'if' ? node.branches.some((b) => b.children.some(isContent)) : node.children.some(isContent);
  const label = node.kind === 'element' ? `<${node.name}>` : node.kind === 'if' ? '{#if}' : '{#each}';
  if (hasContent) {
    diags.warn(node.kind === 'element' ? 'unclosed_element' : 'unclosed_block', `${label} was closed automatically`, node.pos);
  } else {
    const i = frame.parent.indexOf(node);
    if (i >= 0) frame.parent.splice(i, 1);
    diags.warn(node.kind === 'element' ? 'unclosed_element' : 'unclosed_block', `Empty unclosed ${label} was dropped`, node.pos);
  }
}

function isContent(n: Node): boolean {
  return n.kind !== 'text' || n.value.trim() !== '';
}
