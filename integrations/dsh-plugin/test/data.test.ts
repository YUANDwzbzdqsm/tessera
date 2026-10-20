import { describe, expect, it } from 'vitest';
import {
  applyOutputs,
  argumentText,
  describeValue,
  KEEP,
  MAX_BINDINGS,
  MAX_TEXT,
  OUTPUTS_KEY,
  outputsProjection,
  parseOutputsState,
  resolveData,
  type OutputsState,
} from '../src/data';
import { apply, renderUi } from '../src/host';
import { META_KEY, TOOL_NAME } from '../src/shared';

// Session events the way the harness logs them: tool/call with the model's arguments, tool/result with the message
// the model saw and, for some tools, presentation metadata.
let seq = 0;
const call = (callId: string, name: string, args: unknown) => ({
  type: 'tool/call',
  seq: seq++,
  data: { turn: 1, step: 1, callId, name, arguments: args },
});
const result = (callId: string, text: string, extra: Record<string, unknown> = {}, isError = false) => ({
  type: 'tool/result',
  seq: seq++,
  data: {
    turn: 1,
    step: 1,
    message: { id: `m-${callId}`, role: 'tool', toolCallId: callId, source: { kind: 'tool', callId }, content: [{ type: 'text', text }], ...(isError ? { isError } : {}) },
    ...extra,
  },
});

const PKG = { name: 'tessera-monorepo', version: '0.4.2', scripts: { test: 'vitest run' } };
const PKG_LINES = JSON.stringify(PKG, null, 2).split('\n');
// read returns line-numbered text to the model and the raw lines in its presentation metadata.
const readPkg = (callId: string) => [
  call(callId, 'read', { file_path: 'C:\\repo\\package.json' }),
  result(callId, PKG_LINES.map((l, i) => `${i + 1}\t${l}`).join('\n'), {
    meta: { path: 'C:\\repo\\package.json', offset: 1, lines: PKG_LINES.map((text, i) => ({ number: i + 1, text })), totalLines: PKG_LINES.length },
  }),
];
const LOG = 'cf7697b feat(demo): PullRequest card\n3582abd feat(lang): fenced code blocks\nb5eb43b fix(walkthrough): CRLF\n';
const gitLog = (callId: string) => [
  call(callId, 'bash', JSON.stringify({ command: 'git log --oneline -3', description: 'Show recent commits' })),
  result(callId, LOG),
];

const fold = (events: { type: string; data: unknown }[]): OutputsState => events.reduce(applyOutputs, outputsProjection.init());

describe('tool outputs projection', () => {
  it('keeps what each call returned: a file read without line numbers, a command its output', () => {
    const { outputs } = fold([...readPkg('r1'), ...gitLog('b1')]);
    expect(outputs).toEqual([
      { callId: 'r1', tool: 'read', args: 'C:\\repo\\package.json', status: 'ok', text: PKG_LINES.join('\n') },
      { callId: 'b1', tool: 'bash', args: 'git log --oneline -3 Show recent commits', status: 'ok', text: LOG },
    ]);
  });

  it('skips render_ui itself, keeps the first result of a call and notes failures', () => {
    const { outputs } = fold([
      call('u1', TOOL_NAME, { source: '# hi' }),
      result('u1', 'The interface is shown to the user.'),
      call('b2', 'bash', { command: 'false' }),
      result('b2', 'boom', {}, true),
      ...gitLog('b3'),
      // Compaction may log a pruned copy of an old result later; the binding keeps the original.
      result('b3', '[pruned]'),
      call('b4', 'bash', { command: 'sleep 100' }),
    ]);
    expect(outputs.map((o) => [o.callId, o.status, o.text])).toEqual([
      ['b2', 'error', null],
      ['b3', 'ok', LOG],
      ['b4', 'pending', null],
    ]);
  });

  it('marks results too large to bind, and keeps only the latest calls', () => {
    const big = fold([call('x', 'bash', { command: 'cat big.log' }), result('x', 'y'.repeat(MAX_TEXT + 1))]);
    expect(big.outputs[0]).toMatchObject({ status: 'too_large', size: MAX_TEXT + 1, text: null });

    const many = fold(Array.from({ length: KEEP + 5 }, (_, i) => gitLog(`g${i}`)).flat());
    expect(many.outputs).toHaveLength(KEEP);
    expect(many.outputs[0]!.callId).toBe('g5');
  });

  it('returns the same state for events it does not care about', () => {
    const state = fold(gitLog('s1'));
    expect(applyOutputs(state, { type: 'user/message', data: {} })).toBe(state);
    expect(applyOutputs(state, result('unknown', 'x'))).toBe(state);
  });

  it('round-trips through a persisted checkpoint and rejects malformed ones', () => {
    const state = fold([...readPkg('c1'), ...gitLog('c2')]);
    expect(parseOutputsState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(() => parseOutputsState({ outputs: [{ callId: 1 }] })).toThrow();
    expect(() => parseOutputsState(null)).toThrow();
    expect(outputsProjection.key).toBe(OUTPUTS_KEY);
  });

  it('describes names and fields without values', () => {
    expect(describeValue(PKG)).toBe('{ name, version, scripts }');
    expect(describeValue([{ title: 'a', price: 1 }])).toBe('list of 1 × { title, price }');
    expect(describeValue(['a', 'b'])).toBe('list of 2 × string');
    expect(describeValue('one\r\n')).toBe('text, 1 line');
    expect(describeValue('\n')).toBe('empty text');
    expect(describeValue(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i])))).toMatch(/k15, … 4 more \}$/);
  });

  it('flattens arguments given as JSON text or objects into one searchable line', () => {
    expect(argumentText('{"command":"ls -la","description":"List files"}')).toBe('ls -la List files');
    expect(argumentText({ file_path: 'a.ts', limit: 20 })).toBe('a.ts 20');
    expect(argumentText('{"cut')).toBe('{"cut');
  });
});

describe('resolveData', () => {
  const { outputs } = fold([...readPkg('r1'), ...gitLog('b1'), call('r2', 'read', { file_path: 'C:\\repo\\README.md' }), result('r2', '# Tessera', { meta: { path: 'C:\\repo\\README.md', offset: 1, lines: [{ number: 1, text: '# Tessera' }], totalLines: 1 } })]);

  it('binds the latest matching call: JSON parsed, other text as a string', () => {
    const { data, bound, problems } = resolveData(
      [
        { name: 'pkg', tool: 'read', match: 'repo/PACKAGE.json' },
        { name: 'log', tool: 'bash', match: 'git log' },
        { name: 'readme', tool: 'read' },
      ],
      outputs,
    );
    expect(problems).toEqual([]);
    expect(data).toEqual({ pkg: PKG, log: LOG, readme: '# Tessera' });
    // The model hears where each name came from and its shape, never the values.
    expect(bound).toEqual([
      'pkg: read C:\\repo\\package.json → { name, version, scripts }',
      'log: bash git log --oneline -3 Show recent commits → text, 3 lines',
      'readme: read C:\\repo\\README.md → text, 1 line',
    ]);
    expect(bound.join('\n')).not.toContain('0.4.2');
  });

  it('explains every name it could not bind', () => {
    const state = fold([
      ...gitLog('b1'),
      call('p1', 'bash', { command: 'npm test' }),
      call('f1', 'read', { file_path: 'missing.txt' }),
      result('f1', 'ENOENT', {}, true),
      call('t1', 'bash', { command: 'cat huge.json' }),
      result('t1', 'z'.repeat(MAX_TEXT + 10)),
    ]);
    const { data, problems } = resolveData(
      [
        { name: 'cfg', tool: 'read', match: 'tsconfig' },
        { name: 'test', tool: 'bash', match: 'npm test' },
        { name: 'missing', tool: 'read', match: 'missing' },
        { name: 'huge', tool: 'bash', match: 'huge' },
        { name: 'ui', tool: 'bash' },
        { name: 'log', tool: 'bash', match: 'git log' },
        { name: 'log', tool: 'bash' },
        { name: 'x' },
      ],
      state.outputs,
    );
    expect(data).toEqual({ log: LOG });
    expect(problems).toEqual([
      'cfg: no earlier read call whose arguments contain "tsconfig". Recent calls: bash cat huge.json; read missing.txt; bash npm test; bash git log --oneline -3 Show recent commits.',
      `test: the latest bash call whose arguments contain "npm test" has not returned yet; call ${TOOL_NAME} after it returns`,
      'missing: the latest read call whose arguments contain "missing" failed, so there is nothing to show',
      `huge: the latest bash call whose arguments contain "huge" returned ${MAX_TEXT + 10} characters, more than the ${MAX_TEXT} that can be bound; narrow it first (a smaller read, head, jq, a filter)`,
      '"ui": a name must be a plain identifier like pkg or log, not a reserved word',
      'log: bound twice; the first one was kept',
      'x: tool is required (the name of the tool that produced the result, e.g. read or bash)',
    ]);
  });

  it('accepts no data, rejects a non-list and caps the number of names', () => {
    expect(resolveData(undefined, outputs)).toEqual({ data: {}, bound: [], problems: [] });
    expect(resolveData({ pkg: 'read' }, outputs).problems).toEqual(['data must be a list of { name, tool, match }']);
    const many = Array.from({ length: MAX_BINDINGS + 2 }, (_, i) => ({ name: `n${i}`, tool: 'bash' }));
    const capped = resolveData(many, outputs);
    expect(Object.keys(capped.data)).toHaveLength(MAX_BINDINGS);
    expect(capped.problems).toEqual([`only ${MAX_BINDINGS} names can be bound per interface; the rest were ignored`]);
  });

  it('gives an empty session a clear answer', () => {
    expect(resolveData([{ name: 'a', tool: 'bash' }], []).problems).toEqual(['a: no earlier bash call. There are no earlier tool calls in this session.']);
  });
});

describe('render_ui with tool data', () => {
  const { outputs } = fold([...readPkg('r1'), ...gitLog('b1')]);
  const SOURCE = '{@let lines = log.trim().split("\\n")}\n## {pkg.name}\n版本 **{pkg.version}**，最近 {lines.length} 次提交\n{#each lines as line}\n- {line}\n{/each}';
  const BINDINGS = [
    { name: 'pkg', tool: 'read', match: 'package.json' },
    { name: 'log', tool: 'bash' },
  ];

  it('compiles against the bound data and reports names and shapes, not values', () => {
    const out = renderUi(SOURCE, BINDINGS, outputs);
    expect(out).toMatchObject({ shown: true, errors: 0, warnings: 0, data: { pkg: PKG, log: LOG } });
    expect(out.text).toBe(
      'The interface is shown to the user.\n' +
        'Bound tool data (shown from the results, not from your text):\n' +
        '- pkg: read C:\\repo\\package.json → { name, version, scripts }\n' +
        '- log: bash git log --oneline -3 Show recent commits → text, 3 lines',
    );
    for (const value of ['0.4.2', 'tessera-monorepo', 'cf7697b']) {
      expect(SOURCE).not.toContain(value);
      expect(out.text).not.toContain(value);
    }
  });

  it('warns about fields that do not exist and names that were not bound', () => {
    const out = renderUi('{pkg.versoin} {cfg.strict}', [{ name: 'pkg', tool: 'read' }, { name: 'cfg', tool: 'read', match: 'tsconfig' }], outputs);
    expect(out.text).toContain('- unknown_field: pkg.versoin does not exist in the tool data');
    expect(out.text).toContain('- unknown_identifier:');
    expect(out.text).toContain('These data names were not bound:\n- cfg: no earlier read call whose arguments contain "tsconfig".');
    expect(out.data).toEqual({ pkg: PKG });
    // A field the source already falls back on is not worth another call.
    expect(renderUi('{pkg.license ?? "未声明"}', [{ name: 'pkg', tool: 'read' }], outputs)).toMatchObject({ errors: 0, warnings: 0 });
  });

  it('says so when the host has no tool outputs to offer', () => {
    const out = renderUi('{pkg.name}', BINDINGS, undefined);
    expect(out.data).toBeUndefined();
    expect(out.text).toContain('- tool data is not available in this session, so no names were bound');
    expect(renderUi('# Hi', undefined, undefined)).toEqual({ shown: true, errors: 0, warnings: 0, text: 'The interface is shown to the user.' });
  });
});

describe('host plugin with session projections', () => {
  // A stand-in for ctx.sessionProjections: folds a session's events through the registered unit on read.
  function host() {
    const units = new Map<string, typeof outputsProjection>();
    const projections = {
      register: (def: unknown) => (units.set((def as typeof outputsProjection).key, def as typeof outputsProjection), () => {}),
      stateOf: (session: { events: { type: string; data: unknown }[] }, key: string) => {
        const unit = units.get(key);
        return unit && session.events.reduce(unit.apply, unit.init());
      },
    };
    let tool: any;
    apply({
      tools: { register: (d) => ((tool = d), () => {}) },
      inject: (deps, callback) => {
        expect(deps).toEqual(['sessionProjections']);
        callback({ tools: { register: () => () => {} }, sessionProjections: projections as never });
      },
    });
    return { tool, units };
  }

  it('registers the projection and resolves names from the calling session', async () => {
    const { tool, units } = host();
    expect([...units.keys()]).toEqual([OUTPUTS_KEY]);
    expect(tool.parameters.properties.data.items.required).toEqual(['name', 'tool']);

    const session = { events: [...readPkg('r1'), ...gitLog('b1'), call('u1', TOOL_NAME, {})] };
    const args = { source: '# {pkg.name} {pkg.version}', data: [{ name: 'pkg', tool: 'read', match: 'package.json' }] };
    const value = await tool.execute(args, { agent: { session } });
    expect(value.data).toEqual({ pkg: PKG });

    // The model reads `render`; the browser reads the metadata, which the harness logs with the result.
    const [content] = tool.output.render(args, value);
    expect(content.text).not.toContain('0.4.2');
    expect(tool.output.presentationMeta(args, value)).toEqual({ [META_KEY]: { pkg: PKG } });
  });

  it('logs empty metadata when nothing was bound, and copes without a session', async () => {
    const { tool } = host();
    const plain = await tool.execute({ source: '# Hi' }, { agent: { session: { events: [] } } });
    expect(tool.output.presentationMeta({}, plain)).toEqual({});
    const orphan = await tool.execute({ source: '{a}', data: [{ name: 'a', tool: 'bash' }] }, undefined);
    expect(orphan.text).toContain('tool data is not available in this session');
  });
});
