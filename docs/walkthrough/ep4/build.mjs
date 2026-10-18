// Builds episode 4 on the v2 player. Every stage panel, the tokenizing scan and the stack demo come from the repo's
// real compiler functions, loaded through Vite.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEpisode, openRepo } from '../series/build-lib.mjs';
import * as script from './script.mjs';

const { example, prefix, nested } = script;
const here = dirname(fileURLToPath(import.meta.url));
const vite = await openRepo();
const L = (p) => vite.ssrLoadModule(`/packages/lang/src/${p}`);
const { tokenize } = await L('tokenize.ts');
const { parse } = await L('parse.ts');
const { toUI } = await L('markdown.ts');
const { Diagnostics } = await L('diagnostics.ts');
const { compile, voidComponents } = await L('compile.ts');
const { guardExpression } = await L('guard.ts');
const { defineCatalog } = await vite.ssrLoadModule('/packages/catalog/src/index.ts');
const catalog = defineCatalog();

const vis = (s) => JSON.stringify(s).replace(/\\n/g, '↵');
const attrText = (a) => (a.value.kind === 'expr' ? `${a.name}={${a.value.source}}` : a.value.kind === 'string' ? `${a.name}="${a.value.value}"` : a.name);

const diags = new Diagnostics();
const tokens = tokenize(example, diags);
const tree = parse(tokens, diags, voidComponents(catalog));
const ui = toUI(tree.nodes, catalog, diags);
const compiled = compile(example, { catalog });
if (diags.list.length || compiled.diagnostics.length) throw new Error('the example should compile cleanly');

const tokenLine = (t) => {
  const kind = t.t.padEnd(10);
  if (t.t === 'text') return kind + vis(t.value);
  if (t.t === 'open') return kind + `<${t.name} ${t.attrs.map(attrText).join(' ')}${t.self ? ' />' : '>'}`;
  if (t.t === 'close') return kind + `</${t.name}>`;
  return kind + (t.source ?? t.test ?? '');
};
const treeLines = (nodes, depth = 1) =>
  nodes.flatMap((n) => {
    const pad = '  '.repeat(depth);
    if (n.kind === 'text') return [`${pad}text     ${vis(n.value)}`];
    if (n.kind === 'expr') return [`${pad}expr     ${n.source}`];
    if (n.kind === 'element') return [`${pad}element  <${n.name} ${n.attrs.map((a) => a.name).join(' ')}${n.children.length ? '>' : ' />'}`, ...treeLines(n.children, depth + 1)];
    return [`${pad}${n.kind}`];
  });
const uiLines = (nodes, depth = 0) =>
  nodes.flatMap((n) => {
    const pad = '  '.repeat(depth);
    if (n.kind === 'text') return [`${pad}${vis(n.value)}`];
    if (n.kind === 'expr') return [`${pad}{${n.source}}`];
    if (n.kind === 'el') return [`${pad}${n.name}${n.attrs.length ? '  ' + n.attrs.map(attrText).join(' ') : ''}`, ...uiLines(n.children, depth + 1)];
    return [`${pad}${n.kind}`];
  });
const guardCases = [
  ['seats * 29', '通过'],
  ['fetch("https://x")', 'fetch 不在白名单里'],
  ['Math.constructor', '不许访问 constructor'],
  ['x = 1', '不许赋值'],
];
const guardLines = guardCases.map(([src, why]) => {
  const issues = guardExpression(src, new Set(['seats', 'setSeats'])).issues.map((i) => i.code);
  return `{${src}}`.padEnd(24) + (issues.length ? `拒绝  ${issues.join(', ')}：${why}` : '通过');
});
if (!guardLines[0].endsWith('通过') || guardLines.slice(1).some((l) => l.endsWith('通过'))) throw new Error('guard examples changed');
const p = compile(prefix, { catalog });
if (p.diagnostics.map((d) => d.code).join() !== 'unterminated_tag') throw new Error('prefix example changed');

const panels = {
  source: { title: '例子：模型写的 Tessera 原文', sub: '5 行', lines: example.split('\n').map((l, i) => `${String(i + 1).padStart(2)}  ${l}`) },
  tokens: { title: 'tokenize 的结果', sub: `${tokens.length} 个词元`, lines: ['#种类      内容', ...tokens.map(tokenLine)], hl: ['directive', 'open', 'expr'] },
  tree: { title: 'parse 的结果', sub: '声明和节点分开放', lines: ['#directives：单独拿出来的声明', ...tree.directives.map((d) => `  ${d.kind}  ${d.name} = ${d.source}`), '#nodes：按出现顺序排好的节点', ...treeLines(tree.nodes)], hl: ['state  seats', 'element'] },
  ui: { title: 'toUI 的结果', sub: '只剩目录里的组件', lines: uiLines(ui), hl: ['Title', 'Bold', 'Slider'] },
  guard: { title: 'guardExpression 的判断', sub: '已声明的名字：seats、setSeats', lines: ['#表达式                   结果', ...guardLines], hl: ['拒绝'] },
  code: { title: 'generate 的结果', sub: `${compiled.code.length} 个字符的程序 + ${compiled.constants.length} 条常量`, syntax: true, lines: ['#code', ...compiled.code.split('\n'), '#constants（常量表）', ...compiled.constants.map((c, i) => `__C[${i}] = ${vis(c)}`)], hl: ['useState', '__C['] },
  prefix: {
    title: '写到一半的输入',
    sub: '停在 max= 这里',
    lines: ['#原文（还没写完）', ...prefix.split('\n'), '#诊断', ...p.diagnostics.map((d) => `${d.severity}  ${d.code}：${d.message}`), '#编译结果', `常量表 ${JSON.stringify(p.constants)}`, ...p.code.split('\n').filter((l) => l.includes('return __h') || l.includes('useState')).map((l) => l.trim())],
    hl: ['unterminated_tag', 'return __h'],
  },
};

// The tokenizing scan: each token spans from its position to the next token's.
const spans = (src, toks) => toks.map((t, i) => ({ start: t.pos, end: i + 1 < toks.length ? toks[i + 1].pos : src.length, kind: t.t }));
// The stack demo: replay the real tokens of the nested example the way parse does.
const nestedTokens = tokenize(nested, new Diagnostics());
const nestedTree = parse(nestedTokens, new Diagnostics(), voidComponents(catalog));
if (nestedTree.nodes[0].name !== 'Box' || nestedTree.nodes[0].children.length !== 3) throw new Error('nested example changed');
const steps = nestedTokens.map((t) => {
  if (t.t === 'open') return t.self ? { tok: `<${t.name} … />`, op: 'add', label: `${t.name}（自闭合）` } : { tok: `<${t.name} ${t.attrs.map(attrText).join(' ')}>`, op: 'push', label: t.name };
  if (t.t === 'close') return { tok: `</${t.name}>`, op: 'pop' };
  if (t.t === 'text') return { tok: vis(t.value), op: 'add', label: `text ${vis(t.value)}` };
  return { tok: `{${t.source}}`, op: 'add', label: `expr ${t.source}` };
});
await vite.close();

for (const ch of script.chapters) {
  for (const b of ch.beats) {
    const sc = b.board?.scene;
    if (sc?.type === 'tokens') Object.assign(sc, { text: example, tokens: spans(example, tokens) });
    if (sc?.type === 'stack') sc.steps = steps;
  }
}
console.log('tokens:', tokens.length, '| stack steps:', steps.map((s) => s.op).join(' '));
buildEpisode({ outFile: join(here, 'tessera-ep4.html'), script, extra: { panels } });
