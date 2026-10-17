import type { Diagnostics } from './diagnostics';

export type RawAttrValue =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'expr'; readonly source: string }
  | { readonly kind: 'bool' };

export interface RawAttr {
  readonly name: string;
  readonly value: RawAttrValue;
  readonly pos: number;
}

export type Token =
  | { readonly t: 'text'; readonly value: string; readonly pos: number }
  | { readonly t: 'expr'; readonly source: string; readonly pos: number }
  | { readonly t: 'directive'; readonly source: string; readonly pos: number }
  | { readonly t: 'open'; readonly name: string; readonly attrs: RawAttr[]; readonly self: boolean; readonly pos: number }
  | { readonly t: 'close'; readonly name: string; readonly pos: number }
  | { readonly t: 'if'; readonly test: string; readonly pos: number }
  | { readonly t: 'elseif'; readonly test: string; readonly pos: number }
  | { readonly t: 'else'; readonly pos: number }
  | { readonly t: 'endif'; readonly pos: number }
  | { readonly t: 'each'; readonly source: string; readonly pos: number }
  | { readonly t: 'endeach'; readonly pos: number };

const UPPER = /[A-Z]/;
const ATTR_NAME = /^[A-Za-z_][\w-]*/;
const TAG_NAME = /^([A-Z][A-Za-z0-9]*|[a-z][a-z0-9]*)/;

/**
 * Models sometimes write raw HTML (`<input type="number">`, `<div style=…>`). Read as text it would show up on screen
 * as markup, so these names are tokenized as tags and then dropped as unknown components. Only known element names
 * count, so prose such as `x <y` stays text.
 */
const HTML_TAGS = new Set(
  ('a abbr article aside audio b blockquote br button canvas caption code dd details div dl dt em fieldset figure footer ' +
    'form h1 h2 h3 h4 h5 h6 header hr i iframe img input label li main mark meter nav ol option p pre progress section ' +
    'select small span strong style sub summary sup svg table tbody td textarea tfoot th thead tr u ul video').split(' '),
);
const HTML_VOID = new Set(['br', 'hr', 'img', 'input']);

/** Whether `<` at `i` (after an optional `/`) starts a tag name: a component, or a known HTML element. */
function tagNameAt(src: string, i: number): boolean {
  if (UPPER.test(src[i] ?? '')) return true;
  const m = /^[a-z][a-z0-9]*/.exec(src.slice(i, i + 12));
  if (!m || !HTML_TAGS.has(m[0])) return false;
  const after = src[i + m[0].length];
  return after === undefined || after === '>' || after === '/' || /\s/.test(after);
}

/**
 * Splits source into tokens. An incomplete construct at the end (an unclosed `{`, a tag without `>`)
 * ends tokenisation: everything from it onward is dropped, which is exactly what a streaming prefix needs.
 */
export function tokenize(src: string, diags: Diagnostics): Token[] {
  const tokens: Token[] = [];
  let text = '';
  let textPos = 0;
  const flush = () => {
    if (text) tokens.push({ t: 'text', value: text, pos: textPos });
    text = '';
  };
  const addText = (s: string, pos: number) => {
    if (!text) textPos = pos;
    text += s;
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1] ?? '';

    if (c === '\\' && (next === '{' || next === '}' || next === '<')) {
      addText(next, i);
      i += 2;
      continue;
    }

    if (c === '{') {
      const end = matchBrace(src, i);
      if (end < 0) {
        diags.warn('unterminated_expression', 'Unclosed { … }; the rest of the source was dropped', i);
        break;
      }
      flush();
      const inner = src.slice(i + 1, end);
      const token = classifyBrace(inner, i, diags);
      if (token) tokens.push(token);
      i = end + 1;
      continue;
    }

    if (c === '<' && next === '/' && tagNameAt(src, i + 2)) {
      const m = /^<\/([A-Z][A-Za-z0-9]*|[a-z][a-z0-9]*)\s*>/.exec(src.slice(i));
      if (!m) {
        if (src.indexOf('>', i) < 0) {
          diags.warn('unterminated_tag', 'Closing tag without >; the rest of the source was dropped', i);
          break;
        }
        diags.error('malformed_tag', 'Malformed closing tag was dropped', i);
        i = src.indexOf('>', i) + 1;
        continue;
      }
      flush();
      tokens.push({ t: 'close', name: m[1]!, pos: i });
      i += m[0].length;
      continue;
    }

    if (c === '<' && tagNameAt(src, i + 1)) {
      const r = readOpenTag(src, i);
      if (r === 'unterminated') {
        diags.warn('unterminated_tag', 'Tag without >; the rest of the source was dropped', i);
        break;
      }
      if (r.kind === 'malformed') {
        diags.error('malformed_tag', 'Malformed tag was dropped', i);
        i = r.end;
        continue;
      }
      flush();
      tokens.push(r.token);
      i = r.end;
      continue;
    }

    addText(c, i);
    i++;
  }
  flush();
  return tokens;
}

function classifyBrace(inner: string, pos: number, diags: Diagnostics): Token | null {
  const s = inner.trim();
  if (s.startsWith('@')) return { t: 'directive', source: s.slice(1).trim(), pos };
  let m: RegExpExecArray | null;
  if ((m = /^#if\s+([\s\S]+)$/.exec(s))) return { t: 'if', test: m[1]!, pos };
  if ((m = /^:else\s+if\s+([\s\S]+)$/.exec(s))) return { t: 'elseif', test: m[1]!, pos };
  if (/^:else$/.test(s)) return { t: 'else', pos };
  if (/^\/if$/.test(s)) return { t: 'endif', pos };
  if ((m = /^#each\s+([\s\S]+)$/.exec(s))) return { t: 'each', source: m[1]!, pos };
  if (/^\/each$/.test(s)) return { t: 'endeach', pos };
  if (/^[#:/]/.test(s)) {
    diags.error('stray_block', `Unknown block tag {${s}}`, pos);
    return null;
  }
  if (!s) return null;
  return { t: 'expr', source: s, pos };
}

type OpenTagResult =
  | 'unterminated'
  | { kind: 'malformed'; end: number }
  | { kind: 'ok'; token: Token; end: number };

function readOpenTag(src: string, start: number): OpenTagResult {
  const nameMatch = TAG_NAME.exec(src.slice(start + 1));
  if (!nameMatch) return 'unterminated';
  const name = nameMatch[1]!;
  const attrs: RawAttr[] = [];
  let i = start + 1 + nameMatch[0].length;
  const malformed = (): OpenTagResult => {
    const gt = src.indexOf('>', i);
    return gt < 0 ? 'unterminated' : { kind: 'malformed', end: gt + 1 };
  };

  for (;;) {
    while (i < src.length && /\s/.test(src[i]!)) i++;
    if (i >= src.length) return 'unterminated';
    if (src.startsWith('/>', i)) return { kind: 'ok', token: { t: 'open', name, attrs, self: true, pos: start }, end: i + 2 };
    if (src[i] === '/') return i + 1 >= src.length ? 'unterminated' : malformed();
    if (src[i] === '>') return { kind: 'ok', token: { t: 'open', name, attrs, self: HTML_VOID.has(name), pos: start }, end: i + 1 };

    const attrMatch = ATTR_NAME.exec(src.slice(i));
    if (!attrMatch) return malformed();
    const attrPos = i;
    const attrName = attrMatch[0];
    i += attrName.length;
    if (src[i] !== '=') {
      attrs.push({ name: attrName, value: { kind: 'bool' }, pos: attrPos });
      continue;
    }
    i++;
    if (i >= src.length) return 'unterminated';
    if (src[i] === '"') {
      const close = src.indexOf('"', i + 1);
      if (close < 0) return 'unterminated';
      attrs.push({ name: attrName, value: { kind: 'string', value: src.slice(i + 1, close) }, pos: attrPos });
      i = close + 1;
    } else if (src[i] === '{') {
      const close = matchBrace(src, i);
      if (close < 0) return 'unterminated';
      attrs.push({ name: attrName, value: { kind: 'expr', source: src.slice(i + 1, close).trim() }, pos: attrPos });
      i = close + 1;
    } else {
      return malformed();
    }
  }
}

/** Index of the `}` matching the `{` at `open`, skipping strings and template literals; -1 if the source ends first. */
export function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      i = skipString(src, i, c);
      if (i < 0) return -1;
    } else if (c === '`') {
      i = skipTemplate(src, i);
      if (i < 0) return -1;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipString(src: string, start: number, quote: string): number {
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === quote) return i;
  }
  return -1;
}

function skipTemplate(src: string, start: number): number {
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '`') return i;
    else if (src[i] === '$' && src[i + 1] === '{') {
      i = matchBrace(src, i + 1);
      if (i < 0) return -1;
    }
  }
  return -1;
}
