import { compile } from '@tessera/lang';
import { describe, expect, it } from 'vitest';
import { definition } from '../src/client';
import { apply, description, renderUi } from '../src/host';
import { catalog, finalSource, META_KEY, NODE_KIND, partialSource, TOOL_NAME } from '../src/shared';

const SOURCE = '## 估价\n{@state n = 2}\n<Box border padding={3}>\n<Button onClick={() => ui.send(`要 ${n} 份 "报价"`)}>下单</Button>\n</Box>';

describe('partialSource', () => {
  const json = JSON.stringify({ source: SOURCE });

  it('decodes every prefix of the streamed arguments to a prefix of the source', () => {
    for (let i = 0; i <= json.length; i++) {
      const got = partialSource(json.slice(0, i));
      if (got !== null) expect(SOURCE.startsWith(got)).toBe(true);
    }
    expect(partialSource(json)).toBe(SOURCE);
  });

  it('waits for the key, and holds back an escape cut in half', () => {
    expect(partialSource('{"sou')).toBeNull();
    expect(partialSource('{"source": "a\\')).toBe('a');
    expect(partialSource('{"source": "a\\u00')).toBe('a');
    expect(partialSource('{"source": "a\\u00e9b\\n')).toBe('aéb\n');
  });

  it('reads a complete call given as text or as an object', () => {
    expect(finalSource(json)).toBe(SOURCE);
    expect(finalSource({ source: SOURCE })).toBe(SOURCE);
    expect(finalSource('{"source": "cut')).toBe('cut');
    expect(finalSource({ other: 1 })).toBeNull();
  });
});

describe('render_ui tool', () => {
  it('registers one tool whose description teaches the markup and binding tool data, without Image', () => {
    const registered: { name: string; description: string }[] = [];
    apply({ tools: { register: (d) => (registered.push(d as never), () => {}) } });
    expect(registered.map((d) => d.name)).toEqual([TOOL_NAME]);
    expect(description).toContain('<PullRequest');
    expect(description).toContain('{@state seats = 8}');
    expect(description).not.toContain('<Image');
    // The host's own rules about the data argument replace lang's generic "available by name" ones.
    expect(description).not.toContain('Tool results are available by name');
    expect(description).toContain('data: [{ "name": "pkg", "tool": "read", "match": "package.json" }]');
    expect(description).toContain('{@let lines = log.trim().split("\\n")}');
    expect(catalog.get('Image')).toBeUndefined();
  });

  it('tells the model what was left out', () => {
    expect(renderUi(SOURCE)).toEqual({ shown: true, errors: 0, warnings: 0, text: 'The interface is shown to the user.' });
    const bad = renderUi('<Rocket />\n<Box gap={99}>x</Box>');
    expect(bad.errors).toBeGreaterThan(0);
    expect(bad.text).toContain('these parts were left out');
    expect(bad.text).toContain('- unknown_component: <Rocket> is not in the catalog');
    expect(bad.text).not.toContain('previous interface');
    expect(renderUi('  ').shown).toBe(false);
  });
});

describe('conversation definition', () => {
  // Drives the Definition the way the assembler does: match, then start or update the Context by id.
  function run(events: { type: string; seq: number; data: unknown }[]) {
    const contexts = new Map<string, { key: string; id: string; state: any; start?: any; matches: any[]; current: Map<string, any> }>();
    const nodes: any[] = [];
    for (const event of events) {
      const m = definition.match(event);
      if (!m) continue;
      let ctx = contexts.get(m.id);
      const match = { event };
      if (!ctx) {
        ctx = { key: `${NODE_KIND}:${m.id}`, id: m.id, state: definition.start(undefined as never, match), start: match, matches: [match], current: new Map() };
        contexts.set(m.id, ctx);
      } else {
        ctx.matches.push(match);
        ctx.state = definition.update(ctx as never, match);
      }
      const node = definition.buildViewNode(ctx as never);
      ctx.current.set('chat', node);
      nodes.push(node);
    }
    return { contexts, nodes };
  }

  const args = JSON.stringify({ source: SOURCE });
  const delta = (seq: number, id: string, text: string, name?: string) => ({
    type: 'assistant/live-chunk',
    seq,
    data: { chunk: { type: 'tool-call-delta', id, ...(name ? { name } : {}), argumentsDelta: text } },
  });

  it('follows the streamed arguments, then settles on the complete call', () => {
    const { nodes } = run([
      delta(1, 'c1', args.slice(0, 5), TOOL_NAME),
      delta(2, 'c1', args.slice(5, 30)),
      delta(3, 'c1', args.slice(30)),
      { type: 'tool/call', seq: 4, data: { callId: 'c1', name: TOOL_NAME, arguments: args } },
    ]);
    // Before the source key arrives there is no row; after that it grows and keeps its key.
    expect(nodes[0]).toBeNull();
    expect(nodes[1].data.final).toBe(false);
    expect(SOURCE.startsWith(nodes[1].data.source)).toBe(true);
    expect(nodes[2].data.source).toBe(SOURCE);
    expect(nodes[3]).toMatchObject({ kind: NODE_KIND, key: `${NODE_KIND}:c1`, visibility: 'visible', anchorSeq: 1, location: { kind: 'session' } });
    expect(nodes[3].data).toEqual({ callId: 'c1', source: SOURCE, final: true, settled: false });
  });

  it('ignores other tools, including their unnamed deltas', () => {
    const { contexts } = run([
      delta(1, 'b1', '{"command": "ls"', 'bash'),
      delta(2, 'b1', '}'),
      { type: 'tool/call', seq: 3, data: { callId: 'b1', name: 'bash', arguments: '{"command": "ls"}' } },
    ]);
    expect(contexts.size).toBe(0);
  });

  it('builds the same row from history, where only the complete call is replayed', () => {
    const { nodes } = run([{ type: 'tool/call', seq: 9, data: { callId: 'h1', name: TOOL_NAME, arguments: { source: SOURCE } } }]);
    expect(nodes[0].data).toEqual({ callId: 'h1', source: SOURCE, final: true, settled: false });
  });

  const PKG = { name: 'tessera-monorepo', version: '0.4.2' };
  const BOUND = '# {pkg.name}\n版本 {pkg.version}';
  const uiResult = (seq: number, id: string, meta?: unknown, isError = false) => ({
    type: 'tool/result',
    seq,
    data: {
      turn: 1,
      step: 1,
      message: { id: `m-${id}`, role: 'tool', toolCallId: id, source: { kind: 'tool', callId: id }, content: [{ type: 'text', text: 'The interface is shown to the user.' }], ...(isError ? { isError } : {}) },
      ...(meta === undefined ? {} : { meta }),
    },
  });

  it('takes the tool data from its own result, so the values never pass through the source', () => {
    const boundArgs = JSON.stringify({ source: BOUND, data: [{ name: 'pkg', tool: 'read', match: 'package.json' }] });
    const { nodes } = run([
      delta(1, 'd1', boundArgs, TOOL_NAME),
      { type: 'tool/call', seq: 2, data: { callId: 'd1', name: TOOL_NAME, arguments: boundArgs } },
      uiResult(3, 'd1', { [META_KEY]: { pkg: PKG } }),
    ]);
    expect(nodes[1].data).toEqual({ callId: 'd1', source: BOUND, final: true, settled: false });
    expect(nodes[2].data).toEqual({ callId: 'd1', source: BOUND, final: true, settled: true, data: { pkg: PKG } });
    expect(nodes[2].key).toBe(nodes[1].key);

    // What the row hands TesseraView: the source compiles cleanly against the data, which holds the values.
    const program = compile(nodes[2].data.source, { catalog, data: nodes[2].data.data });
    expect(program.diagnostics).toEqual([]);
    expect(program.data).toEqual({ pkg: PKG });
    expect(boundArgs).not.toContain('0.4.2');
  });

  it('rebuilds the same row from history: the call, then its result', () => {
    const { nodes } = run([
      { type: 'tool/call', seq: 7, data: { callId: 'h2', name: TOOL_NAME, arguments: { source: BOUND } } },
      uiResult(8, 'h2', { [META_KEY]: { pkg: PKG } }),
    ]);
    expect(nodes[1].data).toEqual({ callId: 'h2', source: BOUND, final: true, settled: true, data: { pkg: PKG } });
  });

  it('claims render_ui results only: by a call it saw, or by its data', () => {
    const readMeta = { path: 'a.json', offset: 1, lines: [{ number: 1, text: '{}' }], totalLines: 1 };
    expect(definition.match(uiResult(1, 'other-read', readMeta))).toBeNull();
    expect(definition.match(uiResult(2, 'never-seen'))).toBeNull();
    // A history window can start between a call and its result; the result is claimed by its data alone.
    expect(definition.match(uiResult(3, 'window-cut', { [META_KEY]: { pkg: PKG } }))).toEqual({ id: 'window-cut', role: 'update' });

    // A render_ui call that failed still settles, without data.
    const { nodes } = run([{ type: 'tool/call', seq: 4, data: { callId: 'e1', name: TOOL_NAME, arguments: { source: BOUND } } }, uiResult(5, 'e1', undefined, true)]);
    expect(nodes[1].data).toEqual({ callId: 'e1', source: BOUND, final: true, settled: true });
  });

  it('hides a row that was shown, instead of withdrawing it', () => {
    const shown = { key: 'k', kind: NODE_KIND, id: 'x', target: 'chat', anchorSeq: 1, location: {}, visibility: 'visible', data: { callId: 'x', source: 'a', final: false } };
    const node = definition.buildViewNode({ key: 'k', id: 'x', state: { args: '', source: null, final: false }, matches: [], current: new Map([['chat', shown]]) } as never);
    expect(node).toMatchObject({ key: 'k', visibility: 'hidden' });
  });
});
