import { defineCatalog, starterComponents } from '@tessera/catalog';
import { describe, expect, it } from 'vitest';
import { compile, systemPrompt, toFallbackMarkdown } from '../src/index';
import { find, render, text, type FakeNode } from './helpers';

const catalog = defineCatalog();
const codes = (src: string) => compile(src, { catalog }).diagnostics.map((d) => d.code);

const TEAM = `## 团队套餐估价
拖动滑块，看看团队**每月**要花多少。
{@state seats = 8}
{@let price = seats * 29}
<Box border padding={3} gap={2}>
<Slider min={1} max={50} value={seats} onChange={setSeats} />
<Title size="xl">{price} 美元/月</Title>
<Button onClick={() => ui.send(\`为 \${seats} 人做预算\`)}>生成方案</Button>
</Box>`;

describe('compile: the team estimate', () => {
  const program = compile(TEAM, { catalog });

  it('compiles without diagnostics', () => {
    expect(program.diagnostics).toEqual([]);
  });

  it('keeps static text in the constants table', () => {
    expect(program.constants).toEqual(['团队套餐估价', '拖动滑块，看看团队', '每月', '要花多少。', ' 美元/月', '生成方案']);
    expect(program.code).not.toContain('团队');
  });

  it('keys state by name and wraps expressions', () => {
    expect(program.code).toContain('__ui.useState("seats", () => __safe(() => (8), undefined))');
    expect(program.code).toContain('"value": __safe(() => (seats), undefined)');
  });

  it('renders the expected tree and reacts to state', () => {
    const first = render(program);
    expect(first.tree.map((n) => (typeof n === 'string' ? n : n.type))).toEqual(['Title', 'Text', 'Box']);
    expect(find(first.tree, 'Title')!.props.size).toBe('lg');
    expect(text(find(first.tree, 'Text')!)).toBe('拖动滑块，看看团队每月要花多少。');
    expect(find(find(first.tree, 'Text')!.children, 'Bold')).toBeDefined();
    const box = find(first.tree, 'Box')!;
    expect(box.props).toEqual({ border: true, padding: 3, gap: 2 });
    expect(text(box.children.filter((c) => typeof c !== 'string' && c.type === 'Title'))).toBe('232 美元/月');

    const slider = find(first.tree, 'Slider')!;
    (slider.props.onChange as (v: number) => void)(9);
    const second = render(program, first.state);
    expect(text(find(second.tree, 'Box')!.children.filter((c) => typeof c !== 'string' && c.type === 'Title'))).toBe('261 美元/月');

    (find(second.tree, 'Button')!.props.onClick as () => void)();
    expect(second.sent).toEqual(['为 9 人做预算']);
  });
});

describe('compile: Markdown', () => {
  it('maps headings, lists and inline formatting to catalog components', () => {
    const { tree } = render(compile('# Big\n### Small\n- one\n- **two**\n\n1. first\n2. second\nA *note* with `code`.', { catalog }));
    expect(tree.map((n) => (n as { type: string }).type)).toEqual(['Title', 'Title', 'List', 'List', 'Text']);
    expect(tree[0]!.props.size).toBe('xl');
    expect(tree[1]!.props.size).toBe('md');
    expect(tree[3]!.props.ordered).toBe(true);
    expect(find(tree, 'Italic')).toBeDefined();
    expect(text(find(tree, 'Code')!)).toBe('code');
  });

  it('joins consecutive lines into one paragraph and splits on blank lines', () => {
    const { tree } = render(compile('line one\nline two\n\nnext paragraph', { catalog }));
    expect(tree).toHaveLength(2);
    expect(text(tree[0]!)).toBe('line one\nline two');
  });

  it('does not treat a spaced asterisk as italic', () => {
    expect(text(render(compile('5 * 3 = 15', { catalog })).tree)).toBe('5 * 3 = 15');
  });

  it('honours escaped braces', () => {
    expect(text(render(compile('use \\{braces\\} literally', { catalog })).tree)).toBe('use {braces} literally');
  });
});

describe('compile: catalog contract', () => {
  it('drops unknown components and props', () => {
    expect(codes('<Rocket />')).toEqual(['unknown_component']);
    expect(codes('<Slider min={1} max={2} value={1} fill="red" />')).toEqual(['unknown_prop']);
  });

  it('validates literal values against the schema', () => {
    expect(codes('<Box gap="1">x</Box>')).toEqual(['invalid_literal']);
    expect(codes('<Box gap={99}>x</Box>')).toEqual(['invalid_literal']);
    expect(codes('<Button onClick="go">x</Button>')).toEqual(['invalid_literal']);
  });

  it('treats a component that takes no children as self-closing, so it cannot swallow what follows', () => {
    // Both benchmark models wrote <Divider> without the slash and lost the rest of the answer before this rule.
    const r = compile('<Divider>\n## After\n<Slider min={1} max={9} value={1} onChange={(v) => v}>\nmore', { catalog });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['missing_self_close', 'missing_self_close']);
    expect(render(r).tree.map((n) => (n as { type: string }).type)).toEqual(['Divider', 'Title', 'Slider', 'Text']);
    const paired = compile('<Divider>text</Divider>', { catalog });
    expect(paired.diagnostics.map((d) => d.code)).toEqual(['missing_self_close']);
    expect(text(render(paired).tree)).toBe('text');
  });
});

describe('compile: raw HTML', () => {
  it('drops HTML controls instead of showing them as markup', () => {
    // A benchmark answer wrote <input type="number" …> twice; before this rule it reached the screen as text.
    const r = compile('Temperature\n<input type="number" value={25} onInput={(e) => e}>\n<img src="x.png">\nafter', { catalog });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['unknown_component', 'unknown_component']);
    expect(text(render(r).tree)).toBe('Temperatureafter');
  });

  it('unwraps HTML containers so their content survives', () => {
    const r = compile('<div class="card">\n## Inside\n<span>kept</span> text\n</div>', { catalog });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['unknown_component', 'unknown_component']);
    expect(render(r).tree.map((n) => (n as { type: string }).type)).toEqual(['Title', 'Text']);
    expect(text(render(r).tree)).toBe('Insidekept text');
  });

  it('leaves comparisons and unknown lowercase words as text', () => {
    expect(text(render(compile('x <y and a<b, 3 < 4, <tag>', { catalog })).tree)).toBe('x <y and a<b, 3 < 4, <tag>');
  });
});

describe('compile: expression guard', () => {
  const cases: [string, string][] = [
    ['{this.x}', 'forbidden_syntax'],
    ['{fetch("https://evil.example")}', 'unknown_identifier'],
    ['{Math.constructor}', 'forbidden_syntax'],
    ['{Math["__proto__"]}', 'forbidden_syntax'],
    ['{new Date()}', 'forbidden_syntax'],
    ['{(() => { while (true) {} })()}', 'forbidden_syntax'],
    ['{__ui}', 'forbidden_syntax'],
    ['{x = 1}', 'forbidden_syntax'],
    ['{1 +}', 'invalid_expression'],
  ];
  it.each(cases)('%s -> %s', (src, code) => {
    expect(codes(src)).toContain(code);
  });

  it('allows ordinary expressions, arrow functions and loop variables', () => {
    const src = '{@state items = ["a", "b"]}\n{#each items.map((s) => s.toUpperCase()) as item, i}\n- {i + 1}. {item}\n{/each}\n{Math.round(2.6)}';
    const program = compile(src, { catalog });
    expect(program.diagnostics).toEqual([]);
    expect(text(render(program).tree)).toBe('1. A2. B3');
  });

  it('hoists directives nested only in elements, but not out of blocks', () => {
    // A benchmark answer wrapped everything, directives included, in one <Box> and lost every name.
    const r = compile('<Box gap={2}>\n{@state n = 2}\n{@let twice = n * 2}\n<Box>\n{twice}\n</Box>\n</Box>', { catalog });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['directive_hoisted', 'directive_hoisted']);
    expect(text(render(r).tree)).toBe('4');
    expect(codes('{#if true}\n{@state n = 1}\n{/if}')).toEqual(['directive_not_top_level']);
    expect(codes('<Box>\n{#each [1] as x}\n{@let y = x}\n{/each}\n</Box>')).toEqual(['directive_not_top_level']);
  });

  it('reserves names and rejects duplicates', () => {
    expect(codes('{@state Math = 1}')).toEqual(['reserved_name']);
    expect(codes('{@state a = 1}\n{@let a = 2}')).toEqual(['duplicate_name']);
    expect(codes('{@let b = c}\n{@let c = 1}')).toEqual(['unknown_identifier']);
  });
});

describe('compile: control flow', () => {
  it('compiles if / else if / else', () => {
    const src = '{@state n = 5}\n{#if n > 10}\nbig\n{:else if n > 3}\nmedium\n{:else}\nsmall\n{/if}';
    const state = new Map<string, unknown>();
    expect(text(render(compile(src, { catalog }), state).tree)).toBe('medium');
    state.set('n', 1);
    expect(text(render(compile(src, { catalog }), state).tree)).toBe('small');
  });

  it('isolates a throwing expression to one value', () => {
    const { tree, errors } = render(compile('before {JSON.parse("{")} after', { catalog }));
    expect(text(tree)).toBe('before  after');
    expect(errors).toHaveLength(1);
  });
});

describe('compile: partial sources', () => {
  it('drops a half-written tag and an empty unclosed parent', () => {
    const r = compile('## Hi\n<Box>\n<Slider min={1} max=', { catalog });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['unterminated_tag', 'unclosed_element']);
    expect(render(r).tree.map((n) => (n as { type: string }).type)).toEqual(['Title']);
  });

  it('closes an unclosed element that already has content', () => {
    const r = compile('<Box gap={2}>\n## Inside', { catalog });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['unclosed_element']);
    expect(text(find(render(r).tree, 'Box')!)).toBe('Inside');
  });

  it('drops an unterminated directive or expression', () => {
    expect(codes('{@state a = ')).toEqual(['unterminated_expression']);
    expect(text(render(compile('price: {pri', { catalog })).tree)).toBe('price:');
  });

  it('never throws on any prefix of a full program', () => {
    for (let i = 0; i <= TEAM.length; i++) {
      const r = compile(TEAM.slice(0, i), { catalog });
      expect(() => render(r)).not.toThrow();
    }
  });
});

// Code is where braces, <, # and * are everywhere and mean nothing: a Lisp tokenizer answer once lost its whole second
// half (and the widget at the end) to `"([{"` being read as an expression.
const PY = [
  'def tokenize(src):',
  '    depth = 0',
  '    for tok in src.replace("(", " ( ").split():',
  '        depth += 1 if tok in "([{" else -1  # {not an expression} <Box>',
  '    return {"depth": depth, "ok": depth == 0}',
  '',
  '',
  'print(**{"a": 1})',
].join('\n');
const CODE = [
  '## A tokenizer',
  'Each `(` opens a list; `{x}` and `<Box>` are just text here.',
  '```python',
  PY,
  '```',
  '{@state depth = 2}',
  '<Slider min={0} max={9} value={depth} onChange={setDepth} />',
  'Depth is **{depth}**.',
].join('\n');

const all = (nodes: (FakeNode | string)[], type: string): FakeNode[] =>
  nodes.flatMap((n) => (typeof n === 'string' ? [] : [...(n.type === type ? [n] : []), ...all(n.children, type)]));

describe('compile: code', () => {
  const program = compile(CODE, { catalog });
  const { tree } = render(program);

  it('keeps fenced code verbatim and goes on after it', () => {
    expect(program.diagnostics).toEqual([]);
    expect(tree.map((n) => (n as FakeNode).type)).toEqual(['Title', 'Text', 'CodeBlock', 'Slider', 'Text']);
    const block = find(tree, 'CodeBlock')!;
    expect(block.props.language).toBe('python');
    expect(text(block)).toBe(PY);
    expect(find(tree, 'Slider')!.props.value).toBe(2);
    expect(text(tree[4]!)).toBe('Depth is 2.');
  });

  it('keeps inline code verbatim', () => {
    expect(all(tree, 'Code').map(text)).toEqual(['(', '{x}', '<Box>']);
  });

  it('stores code as data, never as program text', () => {
    expect(program.constants).toContain(PY);
    expect(program.code).not.toContain('tokenize');
  });

  it('shows a half-written block as code on every prefix', () => {
    const open = CODE.indexOf('```python\n') + '```python\n'.length;
    for (let i = 0; i <= CODE.length; i++) {
      const r = compile(CODE.slice(0, i), { catalog });
      expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      const block = find(render(r).tree, 'CodeBlock');
      if (i >= open && i < CODE.indexOf('\n```\n')) expect(PY.startsWith(text(block!))).toBe(true);
    }
  });

  it('warns about a fence that is never closed and shows the rest as code', () => {
    const r = compile('Intro\n```js\nconst a = {b: 1};\nif (a < b) {}', { catalog });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['unclosed_code']);
    expect(text(find(render(r).tree, 'CodeBlock')!)).toBe('const a = {b: 1};\nif (a < b) {}');
  });

  it('reads ~~~ fences, longer fences and indented fences', () => {
    expect(text(find(render(compile('~~~md\n```js\nx\n```\n~~~', { catalog })).tree, 'CodeBlock')!)).toBe('```js\nx\n```');
    expect(text(find(render(compile('````\n```\n````', { catalog })).tree, 'CodeBlock')!)).toBe('```');
    expect(text(find(render(compile('1. Run:\n   ```sh\n   npm test\n     --watch\n   ```', { catalog })).tree, 'CodeBlock')!)).toBe('npm test\n  --watch');
  });

  it('leaves a stray backtick as a character', () => {
    const r = render(compile('Press ` then\n<Button>Go</Button>\n\nnext', { catalog }));
    expect(find(r.tree, 'Button')).toBeDefined();
    expect(text(r.tree[0]!)).toContain('Press ` then');
    expect(text(render(compile('a \\`b\\` c', { catalog })).tree)).toBe('a `b` c');
  });

  it('writes code back as Markdown in the fallback', () => {
    const md = toFallbackMarkdown(CODE, { catalog });
    expect(md).toContain('```python\n' + PY + '\n```');
    expect(md).toContain('`{x}` and `<Box>`');
    expect(md).toContain('Depth is **2**.');
    expect(toFallbackMarkdown('~~~\nuse ``` here\n~~~', { catalog })).toBe('````\nuse ``` here\n````');
    expect(toFallbackMarkdown('`` a`b ``', { catalog })).toBe('``a`b``');
  });
});

describe('systemPrompt', () => {
  it('teaches the syntax and lists the catalog', () => {
    const p = systemPrompt(catalog, { extra: 'Answer in Chinese.' });
    expect(p).toContain('{@state seats = 8}');
    expect(p).toContain('<Slider min: number');
    expect(p.trimEnd().endsWith('Answer in Chinese.')).toBe(true);
  });

  it('ships an example that compiles cleanly', () => {
    const example = systemPrompt(catalog).split('Example\n')[1]!;
    expect(compile(example, { catalog }).diagnostics).toEqual([]);
  });

  it('lets a host replace the intro and leave out rules that do not apply to it', () => {
    const p = systemPrompt(catalog, { intro: 'Call render_ui with Tessera markup.', toolData: false });
    expect(p.startsWith('Call render_ui with Tessera markup.\n\nSyntax\n')).toBe(true);
    expect(p).not.toContain('You can answer with an interactive interface');
    expect(p).not.toContain('Tool results are available by name');
    // The default catalog has <Image>, so the rule about server-resolved components stays.
    expect(p).toContain('resolved by the server');
    const noImage = defineCatalog(starterComponents.filter((c) => c.name !== 'Image'));
    expect(systemPrompt(noImage)).not.toContain('resolved by the server');
    expect(systemPrompt(noImage)).toContain('always self-closing: <Divider />, <Slider … />, <Progress … />.');
    expect(systemPrompt(noImage)).toContain('Tool results are available by name');
  });
});
