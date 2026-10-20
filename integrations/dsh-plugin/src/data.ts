import { bindingNames } from '@tessera/lang';
import { TOOL_NAME } from './shared';

// Tool data for render_ui: earlier tool results the interface shows by name ({pkg.version}), so their values never
// pass through the model's markup. The host folds the session log into a short list of recent tool outputs (a
// session projection, so it is rebuilt from history after a restart), resolves the names a render_ui call asks for
// against it, and stores the resolved table in that call's own result. The browser reads the table from there,
// which keeps the row replayable from history even when the referenced calls are outside the loaded window.

/** Session projection key of the recent tool outputs. Host-only: no client view. */
export const OUTPUTS_KEY = 'tessera.toolOutputs';

/** Recent tool calls kept per session, oldest dropped first. */
export const KEEP = 24;

/** The largest result text that can be bound, in characters. Larger ones are named in feedback instead. */
export const MAX_TEXT = 100_000;

/** Names one render_ui call may bind. */
export const MAX_BINDINGS = 8;

const MAX_ARGS = 1_000;

export interface ToolOutput {
  readonly callId: string;
  readonly tool: string;
  /** The call's argument values as one line, which `match` searches. */
  readonly args: string;
  readonly status: 'pending' | 'ok' | 'error' | 'too_large';
  /** What the call returned, when status is ok. */
  readonly text: string | null;
  /** Length of the result text, when status is too_large. */
  readonly size?: number;
}

export interface OutputsState {
  readonly outputs: readonly ToolOutput[];
}

interface SessionEventLike {
  readonly type: string;
  readonly data: any;
}

/** The argument values of a call, flattened into one line: paths, commands, descriptions. */
export function argumentText(args: unknown): string {
  let value = args;
  if (typeof args === 'string') {
    try {
      value = JSON.parse(args);
    } catch {
      return args.slice(0, MAX_ARGS);
    }
  }
  const parts: string[] = [];
  const visit = (v: unknown): void => {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') parts.push(String(v));
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(value);
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_ARGS);
}

/**
 * The text a tool/result event carries: for read, the file's lines without their numbers (from the result's
 * presentation metadata); otherwise the text the model saw. Null when the call failed.
 */
export function resultText(data: any): string | null {
  const message = data?.message;
  if (!message || message.isError) return null;
  const meta = data.meta;
  if (meta && typeof meta.path === 'string' && Array.isArray(meta.lines) && meta.lines.every((l: any) => typeof l?.text === 'string')) {
    return meta.lines.map((l: { text: string }) => l.text).join('\n');
  }
  const blocks: unknown[] = Array.isArray(message.content) ? message.content : [];
  return blocks
    .filter((b): b is { type: 'text'; text: string } => (b as any)?.type === 'text' && typeof (b as any).text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/** The fold: tool/call adds a pending entry, its first tool/result settles it. Unrelated events keep the state. */
export function applyOutputs(state: OutputsState, event: SessionEventLike): OutputsState {
  if (event.type === 'tool/call') {
    const { callId, name } = event.data ?? {};
    if (typeof callId !== 'string' || typeof name !== 'string' || name === TOOL_NAME) return state;
    const entry: ToolOutput = { callId, tool: name, args: argumentText(event.data.arguments), status: 'pending', text: null };
    return { outputs: [...state.outputs, entry].slice(-KEEP) };
  }
  if (event.type === 'tool/result') {
    const callId = event.data?.message?.toolCallId;
    // Only the first result counts: compaction may later replace it with a pruned copy for the model.
    const index = state.outputs.findIndex((o) => o.callId === callId && o.status === 'pending');
    if (index < 0) return state;
    const text = resultText(event.data);
    const before = state.outputs[index]!;
    const settled: ToolOutput =
      text === null ? { ...before, status: 'error' }
      : text.length > MAX_TEXT ? { ...before, status: 'too_large', size: text.length }
      : { ...before, status: 'ok', text };
    const outputs = [...state.outputs];
    outputs[index] = settled;
    return { outputs };
  }
  return state;
}

/** The projection unit the host registers with ctx.sessionProjections. */
export const outputsProjection = {
  key: OUTPUTS_KEY,
  stateVersion: 1,
  stateSchema: { parse: parseOutputsState },
  init: (): OutputsState => ({ outputs: [] }),
  apply: applyOutputs,
};

/** Checks a persisted checkpoint before the registry trusts it; throws on anything unexpected. */
export function parseOutputsState(value: unknown): OutputsState {
  const outputs = (value as OutputsState | null)?.outputs;
  if (!Array.isArray(outputs)) throw new TypeError(`${OUTPUTS_KEY}: outputs must be an array`);
  for (const o of outputs) {
    if (typeof o?.callId !== 'string' || typeof o.tool !== 'string' || typeof o.args !== 'string'
      || !['pending', 'ok', 'error', 'too_large'].includes(o.status) || (o.text !== null && typeof o.text !== 'string')) {
      throw new TypeError(`${OUTPUTS_KEY}: malformed output entry`);
    }
  }
  return value as OutputsState;
}

/** A result's text as a value: parsed when it is a JSON object or array, otherwise the text itself. */
export function toValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      // -0 is not lossless JSON, which the session log rejects.
      return JSON.parse(trimmed, (_key, v) => (Object.is(v, -0) ? 0 : v));
    } catch {
      // Not JSON after all: bind the text.
    }
  }
  return text;
}

/** "{ name, version }", "list of 3 × { title, price }", "text, 5 lines": names and fields, never values. */
export function describeValue(value: unknown, nested = false): string {
  if (typeof value === 'string') {
    if (nested) return 'string';
    // Command output usually ends with a newline; it does not make another line.
    const text = value.replace(/\r?\n$/, '');
    if (!text) return 'empty text';
    const lines = text.split('\n').length;
    return `text, ${lines} line${lines === 1 ? '' : 's'}`;
  }
  if (Array.isArray(value)) return `list of ${value.length}${value.length ? ` × ${describeValue(value[0], true)}` : ''}`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    return `{ ${keys.slice(0, 16).join(', ')}${keys.length > 16 ? `, … ${keys.length - 16} more` : ''} }`;
  }
  return value === null ? 'null' : typeof value;
}

export interface Binding {
  readonly name: string;
  readonly tool: string;
  readonly match?: string;
}

export interface ResolvedData {
  /** Name → value, for compile and for the browser. */
  readonly data: Readonly<Record<string, unknown>>;
  /** One line per bound name: where it came from and its shape. */
  readonly bound: readonly string[];
  /** One line per name that could not be bound. */
  readonly problems: readonly string[];
}

const normalize = (s: string) => s.replace(/\\/g, '/').toLowerCase();
const label = (o: ToolOutput) => `${o.tool} ${o.args.length > 60 ? o.args.slice(0, 59) + '…' : o.args}`.trim();

/** Resolves render_ui's `data` argument against the session's recent tool outputs. */
export function resolveData(bindings: unknown, outputs: readonly ToolOutput[]): ResolvedData {
  const data: Record<string, unknown> = {};
  const bound: string[] = [];
  const problems: string[] = [];
  if (bindings === undefined || bindings === null) return { data, bound, problems };
  if (!Array.isArray(bindings)) return { data, bound, problems: ['data must be a list of { name, tool, match }'] };

  const recent = () => {
    const last = outputs.slice(-5).reverse().map(label);
    return last.length ? ` Recent calls: ${last.join('; ')}.` : ' There are no earlier tool calls in this session.';
  };

  for (const [i, raw] of bindings.entries()) {
    if (i >= MAX_BINDINGS) {
      problems.push(`only ${MAX_BINDINGS} names can be bound per interface; the rest were ignored`);
      break;
    }
    const b = raw as Partial<Binding> | null;
    const name = typeof b?.name === 'string' ? b.name : '';
    if (!name || bindingNames({ [name]: 0 }).length === 0) {
      problems.push(`${JSON.stringify(name)}: a name must be a plain identifier like pkg or log, not a reserved word`);
      continue;
    }
    if (name in data) {
      problems.push(`${name}: bound twice; the first one was kept`);
      continue;
    }
    if (typeof b?.tool !== 'string' || !b.tool) {
      problems.push(`${name}: tool is required (the name of the tool that produced the result, e.g. read or bash)`);
      continue;
    }
    const tool = b.tool;
    const match = typeof b.match === 'string' && b.match.trim() ? b.match.trim() : undefined;
    const candidates = outputs.filter(
      (o) => o.tool.toLowerCase() === tool.toLowerCase() && (match === undefined || normalize(o.args).includes(normalize(match))),
    );
    const which = `${tool} call${match ? ` whose arguments contain ${JSON.stringify(match)}` : ''}`;
    const found = [...candidates].reverse().find((o) => o.status === 'ok');
    if (!found) {
      const latest = candidates.at(-1);
      problems.push(
        !latest ? `${name}: no earlier ${which}.${recent()}`
        : latest.status === 'pending' ? `${name}: the latest ${which} has not returned yet; call ${TOOL_NAME} after it returns`
        : latest.status === 'too_large' ? `${name}: the latest ${which} returned ${latest.size} characters, more than the ${MAX_TEXT} that can be bound; narrow it first (a smaller read, head, jq, a filter)`
        : `${name}: the latest ${which} failed, so there is nothing to show`,
      );
      continue;
    }
    const value = toValue(found.text!);
    data[name] = value;
    bound.push(`${name}: ${label(found)} → ${describeValue(value)}`);
  }
  return { data, bound, problems };
}
